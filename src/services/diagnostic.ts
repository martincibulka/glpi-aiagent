import type { AppConfig } from '../types.ts';
import { GLPIClient } from '../glpi/client.ts';
import { EmbeddingService } from '../ai/embeddings.ts';
import { VectorStore } from '../ai/vectorStore.ts';

export async function runDiagnostics(config: AppConfig): Promise<void> {
  console.log('================================================================');
  console.log('  GLPI AI Agent – Diagnostika pripojenia a konfigurácie        ');
  console.log('================================================================\n');

  let allOk = true;

  // 1. Kontrola konfigurácie
  console.log('[1/4] Kontrola konfigurácie v .env:');
  console.log(`  - GLPI URL:           ${config.glpiUrl || '❌ CHÝBA'}`);
  const hasAppToken = config.glpiAppToken && !config.glpiAppToken.startsWith('vas_glpi');
  console.log(`  - GLPI App-Token:     ${hasAppToken ? '✓ Nastavený (' + config.glpiAppToken.slice(0, 6) + '...)' : '⚠️ Nezadaný (ak má GLPI povolené API bez App-Tokenu, pokračujeme)'}`);
  console.log(`  - GLPI User-Token:    ${config.glpiUserToken ? '✓ Nastavený (' + config.glpiUserToken.slice(0, 6) + '...)' : '❌ CHÝBA'}`);
  console.log(`  - Aktívny AI provider:${config.aiProvider}`);
  if (config.aiProvider === 'gemini') {
    console.log(`  - Gemini API Kľúč:    ${config.geminiApiKey ? '✓ Nastavený' : '❌ CHÝBA'}`);
    console.log(`  - Gemini Model:       ${config.geminiModel}`);
  } else {
    console.log(`  - OpenAI API Kľúč:    ${config.openaiApiKey ? '✓ Nastavený (' + config.openaiApiKey.slice(0, 8) + '...)' : '❌ CHÝBA'}`);
    console.log(`  - OpenAI Model:       ${config.openaiModel}`);
  }

  if (!config.glpiUserToken) {
    console.log('\n❌ [CHYBA] Chýba GLPI_USER_TOKEN v .env!');
    allOk = false;
  }

  // 2. Test pripojenia ku GLPI REST API
  console.log('\n[2/4] Test pripojenia ku GLPI REST API:');
  const glpi = new GLPIClient(config);
  let sessionToken: string | null = null;

  try {
    process.stdout.write(`  - Pripájanie k ${config.glpiUrl}/initSession ... `);
    sessionToken = await glpi.initSession();
    console.log('✓ ÚSPEŠNÉ!');
    console.log(`    Získaný Session-Token: ${sessionToken.slice(0, 10)}...`);

    // Pokus o načítanie nových a vyriešených tiketov
    process.stdout.write('  - Test čítania tiketov z GLPI ... ');
    const resolved = await glpi.getResolvedTickets(10, 0);
    const newTickets = await glpi.getNewTickets(10);
    console.log('✓ ÚSPEŠNÉ!');
    console.log(`    Nájdených vyriešených/uzavretých tiketov v GLPI (vzorka): ${resolved.length}`);
    console.log(`    Nájdených nových čakajúcich tiketov v GLPI: ${newTickets.length}`);

    if (newTickets.length > 0) {
      console.log(`    Aktuálny nový tiket na otestovanie: ID #${newTickets[0].id} ("${newTickets[0].name.slice(0, 50)}")`);
    }
  } catch (err: any) {
    console.log('❌ ZLYHALO!');
    console.error(`    Chyba: ${err.message}`);
    if (err.message.includes('401') || err.message.includes('ERROR_GLPI_LOGIN')) {
      console.log('    💡 Tip: Skontrolujte, či je GLPI_USER_TOKEN správny a či má používateľ v GLPI práva na API.');
    } else if (err.message.includes('400') || err.message.includes('ERROR_APP_TOKEN')) {
      console.log('    💡 Tip: Skontrolujte GLPI_APP_TOKEN v GLPI: Nastavenia -> Všeobecné -> API -> Klienti API.');
    } else if (err.message.includes('certificate') || err.message.includes('SSL')) {
      console.log('    💡 Tip: Ak máte interný/self-signed SSL certifikát, nastavte v .env GLPI_ALLOW_SELF_SIGNED="true".');
    }
    allOk = false;
  } finally {
    if (sessionToken) {
      await glpi.killSession();
    }
  }

  // 3. Test AI modelu a embeddingov
  console.log('\n[3/4] Test pripojenia k AI (Embedding & LLM):');
  const embedder = new EmbeddingService(config);

  try {
    process.stdout.write('  - Test generovania sémantického embeddingu ... ');
    const vec = await embedder.getEmbedding('Test spojenia GLPI AI Agent');
    console.log(`✓ ÚSPEŠNÉ! (Dĺžka vektora: ${vec.length} dimenzií)`);
  } catch (err: any) {
    console.log('❌ ZLYHALO!');
    console.error(`    Chyba: ${err.message}`);
    console.log('    💡 Tip: Skontrolujte váš GEMINI_API_KEY (alebo OPENAI_API_KEY). Kľúč môžete získať na https://aistudio.google.com/');
    allOk = false;
  }

  // 4. Stav lokálnej znalostnej databázy
  console.log('\n[4/4] Stav lokálnej znalostnej databázy:');
  const store = new VectorStore(config.dataDir);
  console.log(`  - Počet zaindexovaných vyriešených tiketov: ${store.count()}`);

  console.log('\n================================================================');
  if (allOk) {
    console.log('  🎉 VŠETKY TESTY PREBEHLI ÚSPEŠNE! Systém je pripravený.        ');
    console.log('================================================================');
    if (store.count() === 0) {
      console.log('\n👉 ĎALŠÍ ODPORÚČANÝ KROK:');
      console.log('   Spustite indexáciu vyriešených tiketov z GLPI:');
      console.log('   npm run ingest\n');
    } else {
      console.log('\n👉 ĎALŠIE MOŽNOSTI TESTOVANIA V PRAXI:');
      console.log('   1. Otestovať jeden konkrétny tiket (bez zápisu do GLPI):');
      console.log('      node --experimental-strip-types --env-file=.env src/index.ts test-ticket <ID_TIKETU>');
      console.log('   2. Analyzovať tiket a zapísať privátnu poznámku do GLPI:');
      console.log('      npm run suggest <ID_TIKETU>');
      console.log('   3. Spustiť automatického agenta na pozadí:');
      console.log('      npm run watch\n');
    }
  } else {
    console.log('  ⚠️ NIEKTORÉ KONTROLY ZLYHALI. Pozrite si tipy vyššie.           ');
    console.log('================================================================\n');
  }
}
