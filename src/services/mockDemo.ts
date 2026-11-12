import type { AppConfig, KnowledgeItem, GLPITicket } from '../types.ts';
import { VectorStore } from '../ai/vectorStore.ts';
import { EmbeddingService } from '../ai/embeddings.ts';
import { TicketSuggester } from '../ai/suggester.ts';

export async function runMockDemo(config: AppConfig): Promise<void> {
  console.log('================================================================');
  console.log('  GLPI AI Agent – Simulácia (Mock Demo bez nutnosti pripojenia) ');
  console.log('================================================================\n');

  const store = new VectorStore(config.dataDir);
  const embedder = new EmbeddingService(config);
  const suggester = new TicketSuggester(config);

  // 1. Vytvoríme ukážkové historické vyriešené tikety
  const sampleResolvedTickets: Array<{
    id: number;
    title: string;
    problem: string;
    solution: string;
  }> = [
    {
      id: 1042,
      title: 'Nefunguje pripojenie na firemnú VPN (FortiClient)',
      problem:
        'Používateľ hlási chybu "Unable to establish the VPN connection (-201)" pri pripájaní z domu na optike Telekom.',
      solution:
        'Overené riešenie: Vo FortiClient nastaveniach adaptéra bolo potrebné nastaviť TLS 1.3 a v sieťovom adaptéri WAN Miniport (IP) resetovať TCP/IP stack príkazom "netsh int ip reset". Následne bol aktualizovaný FortiClient na verziu 7.2.3.',
    },
    {
      id: 1105,
      title: 'Outlook padá pri spustení a pýta heslo v slučke',
      problem:
        'Po zmene hesla v Active Directory sa Microsoft Outlook neustále dookola pýta na heslo a po chvíli zamrzne a spadne.',
      solution:
        'Overené riešenie: V Credential Manager (Správca poverení systému Windows) boli zmazané staré záznamy "MicrosoftOffice16_Data:ADAL:...". Následne v registri vymazaný kľúč Identity v HKCU\\Software\\Microsoft\\Office\\16.0\\Common\\Identity a reštartovaný PC.',
    },
    {
      id: 1189,
      title: 'Tlačiareň HP LaserJet na 2. poschodí netlačí z PDF',
      problem:
        'Pri odoslaní PDF dokumentu z Adobe Readeru tlačiareň vyhodí chybu "Memory Full" alebo vytlačí prázdny hárok s chybou PCL XL.',
      solution:
        'Overené riešenie: V nastaveniach tlačového ovládača HP Universal Print Driver bolo zmenené kódovanie písma z Type42 na Bitmap a v Adobe Readeri zaškrtnutá voľba "Tlačiť ako obrázok" (Print as image).',
    },
    {
      id: 1220,
      title: 'Blokovaný účet v Active Directory po dovolenke',
      problem:
        'Používateľka sa nevie prihlásiť do Windows ani k emailu. Hlásenie: Váš účet bol uzamknutý.',
      solution:
        'Overené riešenie: Skontrolovaný stav v AD Users and Computers. Účet bol uzamknutý z dôvodu nesprávneho hesla uloženého na firemnom mobile (iPhone Mail sync). V AD vykonaný Unlock-ADAccount a na mobile zaktualizované nové heslo na Wi-Fi eduroam/firemnú.',
    },
  ];

  console.log(`[Krok 1] Indexujem ${sampleResolvedTickets.length} vzorových vyriešených tiketov do znalostnej bázy...`);

  for (const t of sampleResolvedTickets) {
    const textToEmbed = `Názov: ${t.title}\nProblém: ${t.problem}\nRiešenie: ${t.solution}`;
    const embedding = await embedder.getEmbedding(textToEmbed);

    const item: KnowledgeItem = {
      id: `glpi-${t.id}`,
      ticketId: t.id,
      title: t.title,
      problem: t.problem,
      solution: t.solution,
      resolvedAt: new Date().toISOString(),
      embedding,
    };

    store.add(item);
    console.log(`  ✓ Tiket #${t.id}: "${t.title}"`);
  }
  store.save();
  console.log(`[Krok 1 Hotový] Vektorová databáza obsahuje ${store.count()} položiek.\n`);

  // 2. Simulácia nového prichádzajúceho tiketu
  const incomingTicket: GLPITicket = {
    id: 9999,
    name: 'Nemôžem sa z domu pripojiť do firemnej siete cez VPN',
    content:
      'Dobrý deň, sedím na home office a FortiClient mi vypisuje chybu pripojenia. Zastaví sa to na 48% a napíše chybu spojenia. Včera to ešte fungovalo. Skúšala som reštartovať router.',
    status: 1, // Nový
    date: new Date().toISOString(),
    urgency: 4,
  };

  console.log('----------------------------------------------------------------');
  console.log(`[Krok 2] Simulácia nového tiketu #${incomingTicket.id}:`);
  console.log(`Predmet: "${incomingTicket.name}"`);
  console.log(`Obsah: "${incomingTicket.content}"`);
  console.log('----------------------------------------------------------------\n');

  console.log('[Krok 3] Sémantické vyhľadávanie v minulých vyriešených tiketoch...');
  const queryText = `Názov: ${incomingTicket.name}\nProblém: ${incomingTicket.content}`;
  const queryEmbedding = await embedder.getEmbedding(queryText);

  // Pri lokálnom fallbacku (slovný hash) je prah nižší než pri dense neuronových embeddingoch (Gemini text-embedding-004)
  const threshold = config.geminiApiKey || config.openaiApiKey ? config.similarityThreshold : 0.15;
  const matches = store.search(queryEmbedding, 2, threshold);
  console.log(`Nájdených zhôd: ${matches.length}`);
  for (const m of matches) {
    console.log(`  -> Zhoda ${Math.round(m.similarity * 100)}%: Tiket #${m.item.ticketId} "${m.item.title}"`);
  }

  console.log('\n[Krok 4] Generovanie AI návrhu pre technika (Human-in-the-loop)...');
  const suggestion = await suggester.generateSuggestion(incomingTicket, matches);

  console.log('\n================================================================');
  console.log('  VÝSLEDNÝ NÁVRH PRE TECHNIKA (Ako by vyzeral v GLPI):');
  console.log('================================================================');
  console.log(suggestion.formattedMarkdown);

  console.log('\n--- GLPI PRIVÁTNA POZNÁMKA (HTML formát pre ITILFollowup) ---');
  console.log(suggestion.formattedHtml);
  console.log('================================================================\n');
  console.log('Simulácia úspešne dokončená!');
}
