# 🤖 GLPI AI Ticket Agent

Inteligentný asistent pre **GLPI Helpdesk & Service Desk**, ktorý sa automaticky učí z minulých vyriešených a uzavretých tiketov (RAG - *Retrieval-Augmented Generation*) a pre nové tikety navrhuje overené riešenia formou **privátnej poznámky (Human-in-the-loop)** pre technikov.

---

## 🎯 Ako to funguje

```
  ┌─────────────────────────┐
  │   GLPI Tiketovací Systém│
  └────────────┬────────────┘
               │
   1. Ingestia vyriešených tiketov (Status: Solved / Closed)
               │
               ▼
  ┌─────────────────────────┐       Embedding        ┌─────────────────────────┐
  │ Predspracovanie a očista│ ─────────────────────► │ Lokálna Vektorová DB    │
  │ (HTML strip, PII filter)│                        │ (data/knowledge_base)   │
  └─────────────────────────┘                        └────────────┬────────────┘
                                                                  │
                                                                  │ 3. Sémantické hľadanie
                                                                  │    zhôd (Cosine Sim)
  ┌─────────────────────────┐       Nový embedding                ▼
  │  Nový prijatý tiket     │ ─────────────────────► ┌─────────────────────────┐
  │  (Status: 1 = New)      │                        │ Top K relevantných      │
  └─────────────────────────┘                        │ historických riešení    │
                                                     └────────────┬────────────┘
                                                                  │
                                                                  ▼
                                                     ┌─────────────────────────┐
                                                     │ LLM Syntéza (Gemini API)│
                                                     │ - Príčina problému      │
                                                     │ - Postup pre technika   │
                                                     │ - Návrh odpovede        │
                                                     └────────────┬────────────┘
                                                                  │
                                4. Vytvorenie privátnej poznámky │
                                   (ITILFollowup, is_private = 1) │
                                                                  ▼
                                                     ┌─────────────────────────┐
                                                     │ Technik v GLPI vidí     │
                                                     │ interný AI návrh        │
                                                     └─────────────────────────┘
```

1. **Ingestia znalostí**: Agent sa pripojí cez GLPI REST API a načíta vyriešené tikety spolu s ich oficiálnym riešením (`ITILSolution`) a kľúčovými komentármi (`ITILFollowup`).
2. **Vektorová pamäť**: Text sa prekonvertuje na sémantické embeddingy (Google Gemini `text-embedding-004` alebo OpenAI `text-embedding-3-small`) a uloží do lokálnej vektorovej bázy.
3. **Prijatie nového tiketu**: Pri novom tikete agent v databáze vyhľadá najpodobnejšie prípady z minulosti.
4. **Human-in-the-loop**: LLM model syntetizuje riešenie a vytvorí **privátnu poznámku (Followup s `is_private = 1`)**. Zákazník / používateľ túto poznámku **nevidí** – vidí ju iba priradený IT technik, ktorý môže odporúčaný postup skontrolovať a návrh odpovede jedným klikom použiť.

---

## ⚡ Rýchly štart

Systém je postavený na modernom **Node.js (v22+)** s natívnou podporou TypeScriptu bez potreby zložitých buildovacích nástrojov.

### 1. Spustenie simulácie bez pripojenia (Mock Demo)
Ak chcete ihneď vidieť, ako agent analyzuje tikety a formuluje odpovede bez pripojenia na GLPI:
```bash
npm run test:mock
```

### 2. Konfigurácia prostredia pre skutočné GLPI
Skopírujte šablónu konfigurácie:
```bash
copy .env.example .env
```
Otvorte `.env` a vyplňte:
- `GLPI_URL`: URL adresa vášho GLPI REST API (napr. `https://glpi.firma.sk/apirest.php`)
- `GLPI_APP_TOKEN`: Aplikačný token z GLPI
- `GLPI_USER_TOKEN`: Používateľský token technika z GLPI
- `GEMINI_API_KEY`: Váš bezplatný API kľúč z [Google AI Studio](https://aistudio.google.com/)

---

## 🔑 Ako získať GLPI API Tokeny

### Krok A: Povolenie API a získanie `GLPI_APP_TOKEN`
1. Prihláste sa do GLPI s rolou administrátora (Super-Admin).
2. Choďte do: **Nastavenia (Setup)** -> **Všeobecné (General)** -> záložka **API**.
3. Povoľte **Aktivovať prihlasovanie cez REST API** (Enable REST API).
4. V tabuľke **Klienti API (API clients)** kliknite na **Pridať (Add)**:
   - Názov: `AI Ticket Agent`
   - Aktívny: `Áno`
   - Vygenerujte **Token aplikácie (App Token)** a skopírujte ho do `.env` ako `GLPI_APP_TOKEN`.

### Krok B: Získanie `GLPI_USER_TOKEN`
1. V pravom hornom rohu GLPI kliknite na svoje meno / profil -> **Môj profil**.
2. Prejdite na záložku **Kľúče vzdialeného prístupu (Remote access keys)** alebo **API tokeny**.
3. Kliknite na **Vytvoriť používateľský token (Regenerate / Create User Token)**.
4. Skopírujte token do `.env` ako `GLPI_USER_TOKEN`.
*(Poznámka: Účet by mal mať práva technika, aby mohol čítať tikety a pridávať interné poznámky).*

---

## 🛠️ Dostupné príkazy

| Príkaz | Popis |
| :--- | :--- |
| `npm run test:mock` | Spustí kompletnú simuláciu s ukážkovými IT tiketmi (offline) |
| `npm run ingest` | Stiahne a zaindexuje vyriešené tikety z GLPI do vektorovej databázy |
| `npm run stats` | Zobrazí počet a prehľad zaindexovaných tiketov v lokálnej báze |
| `npm run watch` | Spustí monitor na pozadí – automaticky spracováva prichádzajúce nové tikety |
| `npm run suggest <id>` | Analyzuje konkrétny tiket podľa ID a pridá privátnu poznámku do GLPI |
| `node --experimental-strip-types --env-file=.env src/index.ts test-ticket <id>` | Dry-run analýza jedného tiketu – zobrazí výsledok iba v termináli (nezapíše do GLPI) |

---

## 📋 Vzhľad vygenerovanej privátnej poznámky v GLPI

Keď agent spracuje nový tiket, technik nájde v GLPI štruktúrovaný záznam:

> 🏷️ **AI ASISTENT NÁVRH** *(Interná poznámka vygenerovaná pre technika)*
>
> 💡 **Pravdepodobná príčina:**  
> Používateľ má expirované heslo v Active Directory, pričom mobilný klient (iOS Mail) po opakovaných neúspešných pokusoch uzamkol účet.
>
> 🔍 **Podobné historické tikety z databázy:**  
> - **Tiket #1220** (91% zhoda) – *Blokovaný účet v Active Directory po dovolenke*
>
> 🛠️ **Odporúčaný postup riešenia:**  
> 1. Otvoriť konzolu Active Directory a vykonať `Unlock-ADAccount` pre dotknutého používateľa.
> 2. Skontrolovať Kerberos lockout logy na doménovom radiči.
> 3. Upozorniť používateľa na nutnosť aktualizácie hesla na mobilnom zariadení.
>
> ✉️ **Návrh odpovede pre používateľa (na skopírovanie):**  
> *"Dobrý deň, váš účet v doméne bol odblokovaný. Prosím, prihláste sa nanovo do počítača novým heslom a nezabudnite toto heslo zaktualizovať aj vo vašom smartfóne."*

---

## ⚙️ Pokročilé nastavenia (.env)

- `SIMILARITY_THRESHOLD`: Minimálny prah sémantickej podobnosti (od `0.0` do `1.0`). Predvolená hodnota je `0.60`. Ak sa nenájde tiket s touto zhodou, agent vygeneruje všeobecnú diagnostickú radu.
- `TOP_K_MATCHES`: Koľko najviac podobných tiketov sa odovzdá do kontextu LLM (predvolene `3`).
- `POLL_INTERVAL_SECONDS`: Interval v sekundách, ako často služba `watch` kontroluje nové tikety v GLPI (predvolene `60s`).
- `GLPI_ALLOW_SELF_SIGNED`: Nastavte na `true`, ak vaše GLPI beží na internom serveri s vlastným (self-signed) SSL certifikátom.
- `AI_PROVIDER`: Možnosť prepnúť medzi `gemini` (Google) a `openai` (GPT-4o-mini).
