const ORTHO_CALENDAR = {
  async request(path, method = 'GET', body, headers = {}) {
    const options = {
      method,
      headers: { ...SHEETS.hdrs(), ...headers },
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response = await fetch('https://www.googleapis.com/calendar/v3/' + path, options);
    if (response.status === 401 && await AUTH._doRefresh()) {
      Object.assign(options.headers, SHEETS.hdrs());
      response = await fetch('https://www.googleapis.com/calendar/v3/' + path, options);
    }
    return response;
  },

  async failure(response, operation) {
    const payload = await response.json().catch(() => null);
    const error = payload?.error;
    const reasons = [...(error?.errors || []), ...(error?.details || [])].map(item => item.reason);
    if (reasons.some(reason => ['accessNotConfigured', 'SERVICE_DISABLED'].includes(reason))) {
      return new Error('ortho 的 Google Cloud 專案尚未啟用 Calendar API');
    }
    if (response.status === 401 || reasons.some(reason =>
      ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))) {
      return new Error('Google 日曆授權不足，請重新授權');
    }
    if (response.status === 403) return new Error(operation + '：Google 拒絕存取（403），請確認 Work 的編輯權限');
    if (response.status === 429) return new Error('Google 日曆暫時限制請求，請稍後重試');
    if (response.status === 412) return new Error('報備剛被其他操作修改，請重試');
    return new Error(operation + '（HTTP ' + response.status + '）');
  },

  async findWork() {
    const matches = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ minAccessRole: 'writer', showHidden: 'true' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await this.request('users/me/calendarList?' + query);
      if (!response.ok) throw await this.failure(response, '無法讀取 Google 日曆');
      const page = await response.json();
      matches.push(...(page.items || []).filter(item => item.summary === 'Work' && item.timeZone === 'Asia/Taipei'));
      pageToken = page.nextPageToken;
    } while (pageToken);
    if (matches.length !== 1) throw new Error('找不到唯一的 Work 日曆');
    return matches[0].id;
  },

  async syncDay(calendar, date, surgeries) {
    const path = 'calendars/' + encodeURIComponent(calendar) + '/events';
    const dayKey = SHEETS.ID + ':' + date;
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const event = {
      summary: '🔴報備',
      description: surgeries.join('\n'),
      start: { date },
      end: { date: next.toISOString().slice(0, 10) },
      attendees: [],
      extendedProperties: { private: { orthoDay: dayKey } },
    };
    const query = new URLSearchParams({ privateExtendedProperty: 'orthoDay=' + dayKey });
    const response = await this.request(path + '?' + query);
    if (!response.ok) throw await this.failure(response, '無法查詢報備');
    const result = await response.json();
    let matches = (result.items || []).filter(item => item.status !== 'cancelled');
    if (matches.length > 1 || result.nextPageToken) throw new Error('找到多筆報備');

    if (!matches.length && surgeries.length) {
      const dayQuery = new URLSearchParams({
        timeMin: date + 'T00:00:00+08:00',
        timeMax: event.end.date + 'T00:00:00+08:00',
        timeZone: 'Asia/Taipei',
      });
      const dayResponse = await this.request(path + '?' + dayQuery);
      if (!dayResponse.ok) throw await this.failure(dayResponse, '無法查詢既有報備');
      const day = await dayResponse.json();
      matches = (day.items || []).filter(item =>
        item.status !== 'cancelled' && item.summary === event.summary &&
        item.start?.date === date && item.end?.date === event.end.date &&
        !item.recurringEventId && !item.recurrence?.length &&
        item.organizer?.self === true
      );
      if (matches.length > 1 || day.nextPageToken) throw new Error('找到多筆報備');
    }

    if (matches.length === 1) {
      const existing = matches[0];
      const headers = existing.etag ? { 'If-Match': existing.etag } : {};
      const itemPath = path + '/' + encodeURIComponent(existing.id);
      const method = surgeries.length ? 'PATCH' : 'DELETE';
      const saved = method === 'PATCH'
        ? await this.request(itemPath + '?conferenceDataVersion=1&sendUpdates=none', method,
          { ...event, conferenceData: null }, headers)
        : await this.request(itemPath + '?sendUpdates=none', method, undefined, headers);
      if (!saved.ok && !(method === 'DELETE' && [404, 410].includes(saved.status))) {
        throw await this.failure(saved, '無法更新或刪除報備');
      }
      return;
    }
    if (!surgeries.length) return;

    // 用固定的日期 ID 防止同時新增重複事件。Google 若仍保留已刪事件的 ID，改用下一代 ID。
    const baseId = 'ortho' + date.replace(/-/g, '');
    for (let generation = 0; generation < 32; generation++) {
      const id = baseId + generation.toString(32);
      const created = await this.request(path + '?conferenceDataVersion=1&sendUpdates=none', 'POST', { ...event, id });
      if (created.ok) return;
      if (created.status !== 409) throw await this.failure(created, '無法建立報備');
      const existing = await this.request(path + '/' + id);
      if (existing.status === 410) continue;
      if (!existing.ok) break;
      const found = await existing.json();
      if (found.status === 'cancelled') continue;
      if (found.extendedProperties?.private?.orthoDay !== dayKey) break;
      const headers = found.etag ? { 'If-Match': found.etag } : {};
      const updated = await this.request(path + '/' + id + '?conferenceDataVersion=1&sendUpdates=none', 'PATCH',
        { ...event, conferenceData: null }, headers);
      if (updated.ok) return;
      throw await this.failure(updated, '無法更新報備');
    }
    throw new Error('無法建立報備');
  },
};
