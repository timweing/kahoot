# Quiz & Umfrage

Ein schlankes, selbst gehostetes Quiz im Stil von Kahoot **plus** ein
Mentimeter-ähnliches Umfragetool (Wordcloud, Single Choice, Wichtigkeit). Ein
Admin lädt Fragen per CSV, Teilnehmer nutzen nur den Browser, Anzeige/Beamer
läuft auf einer separaten View.

## Features
- Quiz: CSV-Import, Zeitlimit pro Frage, Admin-Dashboard, Spieler-UI,
  Scoreboard mit Live-Ranking und Analyse
- Umfrage: Drei Fragetypen (Wordcloud, Single Choice, Wichtigkeit per
  Drag & Drop) mit Live-Auswertung für Admin und Anzeige
- Rollen für beide Welten: `admin`, `player`, `scoreboard` (Quiz) sowie
  `poll-admin`, `poll-participant`, `poll-display`
- Echtzeit-Sync per Socket.IO, Express-Server ohne externe Datenbank

## Projektstruktur
```
├── public/                     # Statische Frontends
│   ├── admin.html/js           # Quiz-Admin
│   ├── player.html/js          # Quiz-Spieler
│   ├── scoreboard.html/js      # Quiz-Scoreboard
│   ├── poll-admin.html/js      # Umfrage-Admin
│   ├── poll-participant.html/js# Umfrage-Teilnehmer
│   └── poll-display.html/js    # Umfrage-Anzeige/Beamer
├── server.js                   # Express + Socket.IO, Quiz & Umfrage
├── package.json                # npm-Skripte und Abhängigkeiten
├── bsp.csv                     # Beispiel für Quiz-CSV
└── poll-sample.csv             # Beispiel für Umfrage-CSV
```

## Voraussetzungen
- [Node.js](https://nodejs.org/) 18 oder neuer
- npm

## Installation & Start
```bash
npm install       # Abhängigkeiten installieren
npm start         # Server auf http://localhost:3000 starten
```
Optional: `PORT=4000 npm start`, Admin-Passwort via `ADMIN_PASSWORD`
(Default: `Admin` für Quiz **und** Umfrage).

## CSV-Formate

### Quiz (Multiple Choice)
Kopfzeile und Spalten:
```
Frage,RichtigeAntwort,FalscheAntwort1,FalscheAntwort2,FalscheAntwort3,ZeitInSekunden
```
Beispiel (`bsp.csv`):
```
Frage,RichtigeAntwort,FalscheAntwort1,FalscheAntwort2,FalscheAntwort3,ZeitInSekunden
Welche Farbe hat der Himmel?,Blau,Grün,Rot,Gelb,20
Wie viele Sekunden hat eine Minute?,60,100,30,45,15
```
Leere falsche Antworten sind erlaubt; fehlende Zeit → 20s Standard.

### Umfrage (Wordcloud, Single, Wichtigkeit)
Kopfzeile:
```
type;question;options;maxWordsPerUser
```
- `type`: `wordcloud` | `single` | `importance`
- `question`: Fragetext
- `options`: Nur bei `single`/`importance`, per `|` getrennt
- `maxWordsPerUser`: Nur bei `wordcloud` (Default 3)

Beispiel (`poll-sample.csv`):
```
type;question;options;maxWordsPerUser
wordcloud;Welche Skills braucht unser Team 2024?;;3
single;Welches Thema priorisieren wir?;Security|Performance|User Experience|Stabilität;
importance;Welche Features sind am wichtigsten?;Dark Mode|Offline-Fähigkeit|Schnelle Suche|Automatisierung;
```

## Typischer Ablauf
1) **Quiz**  
   - Admin: `http://localhost:3000/admin` → CSV hochladen → Quiz starten  
   - Spieler: `http://localhost:3000/player` → Namen wählen → Fragen beantworten  
   - Scoreboard: `http://localhost:3000/scoreboard` (Beamer)

2) **Umfrage**  
   - Poll-Admin: `http://localhost:3000/poll-admin.html` → CSV hochladen → Start / Nächste Frage  
   - Teilnehmer: `http://localhost:3000/poll-participant.html`  
   - Anzeige: `http://localhost:3000/poll-display.html`

Quiz: 1 Punkt pro richtiger Antwort, Mehrfachantworten pro Frage gesperrt,
finale Rangliste + Fragenanalyse.  
Umfrage: Live-Wordcloud (Duplikate erhöhen Gewicht), Single-Choice-Balken,
Wichtigkeitsranking über Drag & Drop (Borda-Score).

## Entwicklung & Anpassung
- Styles: `public/styles.css`
- Logik/Events: `server.js` (Quiz- und Poll-Routen/Socket-Rollen)
- Anpassungen an CSV-Parsing oder Scoring können direkt in `server.js`
  vorgenommen werden.

Viel Spass beim Ausprobieren!
