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
    const started = performance.now();
    try {
      let response = await fetch('https://www.googleapis.com/calendar/v3/' + path, options);
      if (response.status === 401 && await AUTH._doRefresh()) {
        Object.assign(options.headers, SHEETS.hdrs());
        response = await fetch('https://www.googleapis.com/calendar/v3/' + path, options);
      }
      if ([403, 404].includes(response.status)) this.workCache = null;
      return response;
    } finally {
      console.info('[日曆同步] Calendar ' + method + ' ' + Math.round(performance.now() - started) + ' ms');
    }
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
    const account = AUTH.userInfo?.email;
    if (account && this.workCache?.account === account && this.workCache.until > Date.now()) {
      return this.workCache.id;
    }
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
    const id = matches[0].id;
    if (account) this.workCache = { account, id, until: Date.now() + 5 * 60 * 1000 };
    return id;
  },

  eventCache(calendar) {
    const account = AUTH.userInfo?.email;
    if (!account) return null;
    const key = 'ortho_calendar_events:' + JSON.stringify([account, calendar]);
    try {
      const entries = new Map(JSON.parse(localStorage.getItem(key) || '[]'));
      return { key, entries };
    } catch (error) {
      return null;
    }
  },

  descriptionKey(description) {
    return JSON.stringify(String(description || '').split(/\r?\n/).sort());
  },

  matchesReport(existing, expected) {
    return existing.status !== 'cancelled' &&
      existing.summary === expected.summary &&
      existing.start?.date === expected.start.date &&
      existing.end?.date === expected.end.date &&
      existing.extendedProperties?.private?.orthoDay === expected.extendedProperties.private.orthoDay &&
      !existing.conferenceData && !existing.hangoutLink && !existing.attendees?.length &&
      this.descriptionKey(existing.description) === this.descriptionKey(expected.description);
  },

  cacheEvent(cache, date, event, expected) {
    if (!cache) return;
    cache.entries.delete(date);
    if (event?.id && event.etag) {
      const entry = { id: event.id, etag: event.etag, summary: event.summary };
      if (expected && this.matchesReport(event, expected)) entry.descriptionKey = this.descriptionKey(expected.description);
      cache.entries.set(date, entry);
    }
    try {
      localStorage.setItem(cache.key, JSON.stringify([...cache.entries].slice(-180)));
    } catch (error) {}
  },

  async syncDay(calendar, date, surgeries) {
    const path = 'calendars/' + encodeURIComponent(calendar) + '/events';
    const dayKey = SHEETS.ID + ':' + date;
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const event = {
      summary: '刀📌報備',
      description: surgeries.join('\n'),
      start: { date },
      end: { date: next.toISOString().slice(0, 10) },
      attendees: [],
      extendedProperties: { private: { orthoDay: dayKey } },
    };
    const cache = this.eventCache(calendar);
    const cached = cache?.entries.get(date);
    const patch = { ...event, conferenceData: null };
    const writeOptions = '?conferenceDataVersion=1&sendUpdates=none';
    if (surgeries.length && cached?.id && cached.etag) {
      const itemPath = path + '/' + encodeURIComponent(cached.id);
      let etag = cached.etag;
      if (cached.summary === event.summary && cached.descriptionKey === this.descriptionKey(event.description)) {
        const checked = await this.request(itemPath, 'GET', undefined, { 'If-None-Match': etag });
        if (checked.status === 304) return;
        if (checked.ok) {
          const current = await checked.json();
          if (this.matchesReport(current, event)) {
            this.cacheEvent(cache, date, current, event);
            return;
          }
          etag = current.status !== 'cancelled' &&
            current.extendedProperties?.private?.orthoDay === dayKey ? current.etag : null;
        } else if ([404, 410].includes(checked.status)) {
          etag = null;
        } else {
          throw await this.failure(checked, '無法核對報備');
        }
      }
      if (etag) {
        const saved = await this.request(itemPath + writeOptions, 'PATCH', patch, { 'If-Match': etag });
        if (saved.ok) {
          this.cacheEvent(cache, date, await saved.json().catch(() => null), event);
          return;
        }
        if (![404, 410, 412].includes(saved.status)) throw await this.failure(saved, '無法更新報備');
      }
      this.cacheEvent(cache, date, null);
    }
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
        item.status !== 'cancelled' && [event.summary, '🔴報備'].includes(item.summary) &&
        item.start?.date === date && item.end?.date === event.end.date &&
        !item.recurringEventId && !item.recurrence?.length &&
        item.organizer?.self === true
      );
      if (matches.length > 1 || day.nextPageToken) throw new Error('找到多筆報備');
    }

    if (matches.length === 1) {
      const existing = matches[0];
      if (surgeries.length && this.matchesReport(existing, event)) {
        this.cacheEvent(cache, date, existing, event);
        return;
      }
      const headers = existing.etag ? { 'If-Match': existing.etag } : {};
      const itemPath = path + '/' + encodeURIComponent(existing.id);
      const method = surgeries.length ? 'PATCH' : 'DELETE';
      const saved = method === 'PATCH'
        ? await this.request(itemPath + writeOptions, method, patch, headers)
        : await this.request(itemPath + '?sendUpdates=none', method, undefined, headers);
      if (!saved.ok && !(method === 'DELETE' && [404, 410].includes(saved.status))) {
        throw await this.failure(saved, '無法更新或刪除報備');
      }
      this.cacheEvent(cache, date, method === 'PATCH' ? await saved.json().catch(() => null) : null, event);
      return;
    }
    if (!surgeries.length) {
      this.cacheEvent(cache, date, null);
      return;
    }

    // 用固定的日期 ID 防止同時新增重複事件。Google 若仍保留已刪事件的 ID，改用下一代 ID。
    const baseId = 'ortho' + date.replace(/-/g, '');
    for (let generation = 0; generation < 32; generation++) {
      const id = baseId + generation.toString(32);
      const created = await this.request(path + writeOptions, 'POST', { ...event, id });
      if (created.ok) {
        this.cacheEvent(cache, date, await created.json().catch(() => null), event);
        return;
      }
      if (created.status !== 409) throw await this.failure(created, '無法建立報備');
      const existing = await this.request(path + '/' + id);
      if (existing.status === 410) continue;
      if (!existing.ok) break;
      const found = await existing.json();
      if (found.status === 'cancelled') continue;
      if (found.extendedProperties?.private?.orthoDay !== dayKey) break;
      if (this.matchesReport(found, event)) {
        this.cacheEvent(cache, date, found, event);
        return;
      }
      const headers = found.etag ? { 'If-Match': found.etag } : {};
      const updated = await this.request(path + '/' + id + writeOptions, 'PATCH', patch, headers);
      if (updated.ok) {
        this.cacheEvent(cache, date, await updated.json().catch(() => null), event);
        return;
      }
      throw await this.failure(updated, '無法更新報備');
    }
    throw new Error('無法建立報備');
  },
};
