import type { AppConfig, GLPITicket, GLPISolution, GLPIFollowup } from '../types.ts';

/**
 * Klient pre GLPI REST API (apirest.php)
 */
export class GLPIClient {
  private config: AppConfig;
  private sessionToken: string | null = null;

  constructor(config: AppConfig) {
    this.config = config;

    if (config.glpiAllowSelfSigned) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  /**
   * Inicializácia GLPI relácie (initSession)
   */
  async initSession(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;

    const url = `${this.config.glpiUrl}/initSession`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `user_token ${this.config.glpiUserToken}`,
    };

    if (this.config.glpiAppToken && !this.config.glpiAppToken.startsWith('vas_glpi')) {
      headers['App-Token'] = this.config.glpiAppToken;
    }

    const res = await fetch(url, { method: 'GET', headers });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GLPI initSession zlyhalo [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as { session_token: string };
    if (!data.session_token) {
      throw new Error('GLPI API nevrátilo session_token');
    }

    this.sessionToken = data.session_token;
    return this.sessionToken;
  }

  /**
   * Ukončenie relácie (killSession)
   */
  async killSession(): Promise<void> {
    if (!this.sessionToken) return;

    try {
      await fetch(`${this.config.glpiUrl}/killSession`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });
    } catch {
      // Ignorovať chyby pri odhlasovaní
    } finally {
      this.sessionToken = null;
    }
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.sessionToken) {
      throw new Error('GLPI relácia nie je inicializovaná. Zavolajte najskôr initSession().');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Session-Token': this.sessionToken,
    };

    if (this.config.glpiAppToken && !this.config.glpiAppToken.startsWith('vas_glpi')) {
      headers['App-Token'] = this.config.glpiAppToken;
    }

    return headers;
  }

  /**
   * Získanie vyriešených a uzavretých tiketov (status 5 = Solved, status 6 = Closed)
   */
  async getResolvedTickets(limit = 100, start = 0): Promise<GLPITicket[]> {
    await this.initSession();

    // GLPI rozsah záznamov formát: 0-99
    const range = `${start}-${start + limit - 1}`;
    const url = `${this.config.glpiUrl}/Ticket?range=${range}&sort=id&order=DESC`;

    const res = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zlyhalo načítanie tiketov z GLPI [${res.status}]: ${errText}`);
    }

    const tickets = (await res.json()) as GLPITicket[];
    if (!Array.isArray(tickets)) return [];

    // Filtrujeme iba vyriešené (5) a uzavreté (6)
    return tickets.filter((t) => t.status === 5 || t.status === 6);
  }

  /**
   * Získanie nových tiketov (status 1 = New)
   */
  async getNewTickets(limit = 20): Promise<GLPITicket[]> {
    await this.initSession();

    const range = `0-${limit - 1}`;
    const url = `${this.config.glpiUrl}/Ticket?range=${range}&sort=id&order=DESC`;

    const res = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zlyhalo načítanie nových tiketov [${res.status}]: ${errText}`);
    }

    const tickets = (await res.json()) as GLPITicket[];
    if (!Array.isArray(tickets)) return [];

    // Status 1 = Nový
    return tickets.filter((t) => t.status === 1);
  }

  /**
   * Získanie detailu konkrétneho tiketu podľa ID
   */
  async getTicket(id: number): Promise<GLPITicket> {
    await this.initSession();

    const url = `${this.config.glpiUrl}/Ticket/${id}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zlyhalo načítanie tiketu #${id} [${res.status}]: ${errText}`);
    }

    return (await res.json()) as GLPITicket;
  }

  /**
   * Získanie oficiálneho riešenia (ITILSolution) k tiketu
   */
  async getTicketSolutions(ticketId: number): Promise<GLPISolution[]> {
    await this.initSession();

    const url = `${this.config.glpiUrl}/Ticket/${ticketId}/ITILSolution`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Získanie komentárov a sledovaní (ITILFollowup) k tiketu
   */
  async getTicketFollowups(ticketId: number): Promise<GLPIFollowup[]> {
    await this.initSession();

    const url = `${this.config.glpiUrl}/Ticket/${ticketId}/ITILFollowup`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Kontrola, či tiket už obsahuje AI návrh (aby sa nepridával duplicitne)
   */
  async hasAISuggestion(ticketId: number): Promise<boolean> {
    const followups = await this.getTicketFollowups(ticketId);
    return followups.some(
      (f) =>
        f.content &&
        (f.content.includes('AI Asistent Návrh') ||
          f.content.includes('AI Asistent') ||
          f.content.includes('🤖 AI'))
    );
  }

  /**
   * Vytvorenie privátnej poznámky (Private Followup) k tiketu pre technikov
   */
  async addPrivateFollowup(ticketId: number, contentHtml: string): Promise<number> {
    await this.initSession();

    const url = `${this.config.glpiUrl}/Ticket/${ticketId}/ITILFollowup`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        input: {
          items_id: ticketId,
          itemtype: 'Ticket',
          content: contentHtml,
          is_private: this.config.noteIsPrivate, // 1 = privátne
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zlyhalo pridanie poznámky do tiketu #${ticketId} [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as any;
    return data.id || ticketId;
  }
}
