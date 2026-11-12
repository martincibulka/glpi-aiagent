import type { AppConfig, AISuggestion, SearchMatch, GLPITicket } from '../types.ts';
import { cleanTicketDescription, truncate } from '../utils/text.ts';

/**
 * Asistent pre generovanie návrhov riešení tiketov
 */
export class TicketSuggester {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async generateSuggestion(
    newTicket: GLPITicket,
    matches: SearchMatch[]
  ): Promise<AISuggestion> {
    const cleanedProblem = cleanTicketDescription(newTicket.content);

    // Ak máme API kľúč, voláme skutočný model
    let parsed: {
      probableRootCause: string;
      recommendedSteps: string[];
      draftResponseToUser: string;
      missingInformationWarnings: string[];
    };

    if (this.config.aiProvider === 'gemini' && this.config.geminiApiKey) {
      parsed = await this.callGemini(newTicket, cleanedProblem, matches);
    } else if (this.config.aiProvider === 'openai' && this.config.openaiApiKey) {
      parsed = await this.callOpenAI(newTicket, cleanedProblem, matches);
    } else {
      parsed = this.generateOfflineSuggestion(newTicket, cleanedProblem, matches);
    }

    const similarTickets = matches.map((m) => ({
      ticketId: m.item.ticketId,
      title: m.item.title,
      similarity: Math.round(m.similarity * 100),
      solutionSnippet: truncate(m.item.solution, 180),
    }));

    const formattedHtml = this.formatGLPIHtml(newTicket, parsed, similarTickets);
    const formattedMarkdown = this.formatMarkdown(newTicket, parsed, similarTickets);

    return {
      ticketId: newTicket.id,
      probableRootCause: parsed.probableRootCause,
      recommendedSteps: parsed.recommendedSteps,
      draftResponseToUser: parsed.draftResponseToUser,
      missingInformationWarnings: parsed.missingInformationWarnings || [],
      similarTickets,
      formattedHtml,
      formattedMarkdown,
    };
  }

  private buildSystemPrompt(): string {
    return `Si expertný AI asistent pre IT Helpdesk a Service Desk integrovaný do systému GLPI.
Tvojou úlohou je analyzovať nový nahlásený tiket, porovnať ho s overenými riešeniami z minulých vyriešených tiketov a pripraviť interný pracovný návrh pre technika.

Pravidlá:
1. Odpovedaj v slovenskom jazyku.
2. Buď vecný, technicky presný a štruktúrovaný.
3. Výstup musí byť validný JSON v presnom formáte:
{
  "probableRootCause": "Krátka identifikácia a pravdepodobná príčina problému",
  "recommendedSteps": [
    "Krok 1: ...",
    "Krok 2: ..."
  ],
  "draftResponseToUser": "Predpripravená zdvorilá odpoveď používateľovi, ktorú môže technik skopírovať alebo rovno poslať.",
  "missingInformationWarnings": [
    "Ak chýbajú dôležité informácie (napr. IP, verzia SW, chybový kód), uveď ich sem ako varovanie."
  ]
}`;
  }

  private buildUserPrompt(
    ticket: GLPITicket,
    cleanedProblem: string,
    matches: SearchMatch[]
  ): string {
    let pastContext = '';
    if (matches.length > 0) {
      pastContext = matches
        .map((m, idx) => {
          return `--- HISTORICKÝ VYRIEŠENÝ TIKET #${m.item.ticketId} (Podobnosť: ${Math.round(m.similarity * 100)}%) ---
Názov: ${m.item.title}
Problém: ${m.item.problem}
Overené riešenie: ${m.item.solution}
`;
        })
        .join('\n\n');
    } else {
      pastContext = 'V znalostnej databáze sa nenašli priame historické zhody. Použi svoje všeobecné IT znalosti.';
    }

    return `NOVÝ TIKET NA ANALÝZU:
ID: #${ticket.id}
Predmet: ${ticket.name}
Popis od používateľa:
${cleanedProblem}

RELEVANTNÉ ZNALOSTI Z MINULÝCH TIKETOV:
${pastContext}

Vytvor JSON analýzu s príčinou, krokmi riešenia a návrhom odpovede.`;
  }

  private async callGemini(
    ticket: GLPITicket,
    cleanedProblem: string,
    matches: SearchMatch[]
  ) {
    const model = this.config.geminiModel || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiApiKey}`;

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(ticket, cleanedProblem, matches);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini LLM API zlyhalo [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Prázdna odpoveď z Gemini LLM');
    }

    return JSON.parse(text);
  }

  private async callOpenAI(
    ticket: GLPITicket,
    cleanedProblem: string,
    matches: SearchMatch[]
  ) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(ticket, cleanedProblem, matches);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI LLM API zlyhalo [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Prázdna odpoveď z OpenAI LLM');
    }

    return JSON.parse(content);
  }

  private generateOfflineSuggestion(
    ticket: GLPITicket,
    cleanedProblem: string,
    matches: SearchMatch[]
  ) {
    if (matches.length > 0) {
      const best = matches[0].item;
      return {
        probableRootCause: `Súvisí s problémom z minulého tiketu #${best.ticketId} (${best.title}).`,
        recommendedSteps: [
          `Skontrolovať postupy uplatnené v tikete #${best.ticketId}.`,
          `Overiť nastavenia a aplikovať overené riešenie: "${truncate(best.solution, 120)}"`,
          'Kontaktovať používateľa a overiť funkčnosť.',
        ],
        draftResponseToUser: `Dobrý deň,\n\npreverili sme vašu požiadavku. Na vyriešenie problému s "${ticket.name}" sme zaznamenali podobný prípad. Pripravujeme potrebné nastavenia a budeme vás informovať.\n\nS pozdravom,\nIT Podpora`,
        missingInformationWarnings: [],
      };
    }

    return {
      probableRootCause: 'Nový typ požiadavky bez priamej historickej zhody.',
      recommendedSteps: [
        'Vyžiadať doplňujúce podrobnosti (chytovú hlášku, snímku obrazovky).',
        'Preveriť logy na stanici alebo serveri.',
      ],
      draftResponseToUser: `Dobrý deň,\n\nzaevidovali sme vašu požiadavku ohľadom "${ticket.name}". Prosíme vás o doplňujúce informácie alebo snímku chybového hlásenia, aby sme mohli požiadavku rýchlejšie vyriešiť.\n\nS pozdravom,\nIT Podpora`,
      missingInformationWarnings: ['Chýbajú podrobnejšie diagnostické informácie.'],
    };
  }

  private formatGLPIHtml(
    ticket: GLPITicket,
    parsed: {
      probableRootCause: string;
      recommendedSteps: string[];
      draftResponseToUser: string;
      missingInformationWarnings: string[];
    },
    similarTickets: Array<{
      ticketId: number;
      title: string;
      similarity: number;
      solutionSnippet: string;
    }>
  ): string {
    const stepsHtml = parsed.recommendedSteps
      .map((step) => `<li>${step}</li>`)
      .join('');

    let similarHtml = '';
    if (similarTickets.length > 0) {
      similarHtml = `
      <div style="margin-top: 10px; margin-bottom: 10px;">
        <strong>🔍 Podobné historické tikety z databázy:</strong>
        <ul style="margin: 5px 0; padding-left: 20px;">
          ${similarTickets
            .map(
              (s) =>
                `<li><strong>Tiket #${s.ticketId}</strong> (${s.similarity}% zhoda) - <em>${s.title}</em><br><small style="color: #555;">Riešenie: ${s.solutionSnippet}</small></li>`
            )
            .join('')}
        </ul>
      </div>`;
    }

    let warningsHtml = '';
    if (parsed.missingInformationWarnings && parsed.missingInformationWarnings.length > 0) {
      warningsHtml = `
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 8px 12px; margin: 10px 0; color: #856404;">
        <strong>⚠️ Upozornenie:</strong>
        <ul style="margin: 0; padding-left: 18px;">
          ${parsed.missingInformationWarnings.map((w) => `<li>${w}</li>`).join('')}
        </ul>
      </div>`;
    }

    return `
<div style="font-family: Arial, sans-serif; border: 1px solid #17a2b8; border-radius: 6px; padding: 14px; background-color: #f8fbfd;">
  <div style="display: flex; align-items: center; margin-bottom: 8px;">
    <span style="background-color: #17a2b8; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase;">AI Asistent Návrh</span>
    <span style="color: #666; font-size: 12px; margin-left: 10px;">Interná poznámka vygenerovaná pre technika</span>
  </div>

  <p style="margin: 6px 0;"><strong>💡 Pravdepodobná príčina:</strong> ${parsed.probableRootCause}</p>

  ${similarHtml}

  <div style="margin: 10px 0;">
    <strong>🛠️ Odporúčaný postup riešenia:</strong>
    <ol style="margin: 5px 0; padding-left: 20px;">
      ${stepsHtml}
    </ol>
  </div>

  ${warningsHtml}

  <div style="margin-top: 12px; padding: 10px; background-color: #ffffff; border: 1px dashed #b8daff; border-radius: 4px;">
    <strong>✉️ Návrh odpovede pre používateľa (na skopírovanie):</strong>
    <blockquote style="margin: 6px 0; white-space: pre-wrap; color: #333; font-size: 13px;">${parsed.draftResponseToUser}</blockquote>
  </div>
</div>
`.trim();
  }

  private formatMarkdown(
    ticket: GLPITicket,
    parsed: {
      probableRootCause: string;
      recommendedSteps: string[];
      draftResponseToUser: string;
      missingInformationWarnings: string[];
    },
    similarTickets: Array<{
      ticketId: number;
      title: string;
      similarity: number;
      solutionSnippet: string;
    }>
  ): string {
    const similarText =
      similarTickets.length > 0
        ? similarTickets
            .map(
              (s) =>
                `- **Tiket #${s.ticketId}** (${s.similarity}% zhoda) – *${s.title}*\n  > Overené riešenie: ${s.solutionSnippet}`
            )
            .join('\n')
        : '_Žiadne priame historické zhody._';

    const stepsText = parsed.recommendedSteps
      .map((s, idx) => `${idx + 1}. ${s}`)
      .join('\n');

    const warningsText =
      parsed.missingInformationWarnings && parsed.missingInformationWarnings.length > 0
        ? `\n⚠️ **Upozornenia:**\n${parsed.missingInformationWarnings.map((w) => `- ${w}`).join('\n')}\n`
        : '';

    return `
### 🤖 AI Návrh riešenia pre tiket #${ticket.id}: "${ticket.name}"

**💡 Pravdepodobná príčina:**
${parsed.probableRootCause}

**🔍 Podobné historické tikety:**
${similarText}

**🛠️ Odporúčaný postup riešenia:**
${stepsText}
${warningsText}
**✉️ Návrh odpovede pre používateľa:**
\`\`\`text
${parsed.draftResponseToUser}
\`\`\`
`.trim();
  }
}
