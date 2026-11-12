import { loadConfig } from './config.ts';
import { runMockDemo } from './services/mockDemo.ts';
import { runIngestion } from './services/knowledgeIngest.ts';
import { TicketProcessor } from './services/ticketProcessor.ts';
import { VectorStore } from './ai/vectorStore.ts';
import { runDiagnostics } from './services/diagnostic.ts';

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  switch (command) {
    case 'check':
    case 'diag':
    case 'test-conn': {
      await runDiagnostics(config);
      break;
    }

    case 'mock':
    case 'demo': {
      await runMockDemo(config);
      break;
    }

    case 'ingest': {
      const max = args[1] ? parseInt(args[1], 10) : 200;
      await runIngestion(config, max);
      break;
    }

    case 'suggest': {
      const ticketId = parseInt(args[1], 10);
      if (!ticketId || isNaN(ticketId)) {
        console.error('Použitie: npm run suggest <ticketId>');
        process.exit(1);
      }
      const processor = new TicketProcessor(config);
      await processor.processTicket(ticketId, false);
      break;
    }

    case 'test-ticket':
    case 'dry-run': {
      const ticketId = parseInt(args[1], 10);
      if (!ticketId || isNaN(ticketId)) {
        console.error('Použitie: node --experimental-strip-types src/index.ts test-ticket <ticketId>');
        process.exit(1);
      }
      const processor = new TicketProcessor(config);
      await processor.processTicket(ticketId, true);
      break;
    }

    case 'watch': {
      console.log('====================================================');
      console.log('  GLPI AI Agent – Watcher beží na pozadí           ');
      console.log(`  Interval kontroly: každých ${config.pollIntervalSeconds} sekúnd`);
      console.log('  Stlačte Ctrl+C pre ukončenie.');
      console.log('====================================================\n');

      const processor = new TicketProcessor(config);

      const poll = async () => {
        try {
          const count = await processor.checkAndProcessNewTickets();
          if (count > 0) {
            console.log(`[${new Date().toLocaleTimeString()}] Spracovaných ${count} nových tiketov.`);
          }
        } catch (err: any) {
          console.error(`[Watcher Chyba] ${err.message}`);
        }
      };

      // Prvá kontrola ihneď
      await poll();

      // Pravidelná kontrola
      setInterval(poll, config.pollIntervalSeconds * 1000);
      break;
    }

    case 'stats': {
      const store = new VectorStore(config.dataDir);
      console.log('====================================================');
      console.log('  Štatistika znalostnej databázy                    ');
      console.log('====================================================');
      console.log(`Priečinok s dátami: ${config.dataDir}`);
      console.log(`Počet zaindexovaných vyriešených tiketov: ${store.count()}`);
      if (store.count() > 0) {
        console.log('\nPosledných 5 indexovaných tiketov:');
        const items = store.getAll().slice(-5);
        for (const item of items) {
          console.log(`  - #${item.ticketId}: "${item.title}"`);
        }
      }
      console.log('====================================================');
      break;
    }

    default: {
      console.log(`
GLPI AI Ticket Agent - Príkazy:

  npm run test:mock         Spustí simuláciu na ukážkových dátach (bez potreby GLPI)
  npm run ingest            Načíta a zaindexuje vyriešené tikety z GLPI do databázy
  npm run watch             Spustí sledovanie nových tiketov a pridávanie privátnych návrhov
  npm run suggest <id>      Analyzuje konkrétny GLPI tiket a pridá doňho privátnu poznámku
  npm run stats             Zobrazí stav a počet tiketov v lokálnej znalostnej báze

Pred spustením nezabudnite skopírovať .env.example do .env a doplniť vaše údaje.
`);
      break;
    }
  }
}

main().catch((err) => {
  console.error('\n[Kritická chyba]:', err);
  process.exit(1);
});
