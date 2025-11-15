# Quiz

Ein schlankes, selbst gehostetes Quiz im Stil von Kahoot. Ein Admin lädt die
Fragen per CSV hoch, Spieler treten mit dem Browser bei, und eine optionale
Scoreboard-Ansicht zeigt Live-Ranglisten sowie die finale Auswertung.

## Features
- CSV-Import mit frei definierbaren Fragen, drei falschen Antworten und
  konfigurierbarer Zeit pro Frage
- Admin-Dashboard zum Hochladen, Starten und Beobachten von Quiz, Spielern,
  Rangliste und Fragenanalyse
- Spieleroberfläche mit Countdown, animierten Antwortflächen und direktem
  Feedback zu jeder Antwort
- Eigenständige Scoreboard-Seite, die Live-Scores und die finale Rangliste
  präsentiert (ideal für Beamer/TV)
- Echtzeit-Synchronisation über Socket.IO sowie Express-Server ohne externe
  Datenbank

## Projektstruktur

```
├── public/              # Statische Frontends für Admin, Spieler, Scoreboard
│   ├── admin.html/js    # Steuerzentrale inkl. CSV-Upload und Auswertung
│   ├── player.html/js   # Mobilefreundliche Spieleroberfläche
│   └── scoreboard.*     # Read-only Ranglistenansicht
├── server.js            # Express + Socket.IO Backend und CSV-Parsing
├── package.json         # npm-Skripte und Abhängigkeiten
└── bsp.csv              # Beispiel-Datei für das CSV-Format
```

## Voraussetzungen
- [Node.js](https://nodejs.org/) 18 oder neuer
- npm (kommt i. d. R. mit Node mit)

## Installation & Start

```bash
npm install       # Abhängigkeiten installieren
npm start         # Server auf http://localhost:3000 starten
```

Optional kann der Port über `PORT=4000 npm start` angepasst werden.

## CSV-Format

Die Datei benötigt eine Kopfzeile und folgende Spaltenreihenfolge:

```
Frage,RichtigeAntwort,FalscheAntwort1,FalscheAntwort2,FalscheAntwort3,ZeitInSekunden
```

Beispiel (`bsp.csv`):

```
Frage,RichtigeAntwort,FalscheAntwort1,FalscheAntwort2,FalscheAntwort3,ZeitInSekunden
Welche Farbe hat der Himmel?,Blau,Grün,Rot,Gelb,20
Wie viele Sekunden hat eine Minute?,60,100,30,45,15
```

Nicht ausgefüllte falsche Antworten bleiben einfach leer. Falls kein Zeitwert
gesetzt ist, nutzt der Server 20 Sekunden als Standard.

## Typischer Ablauf
1. **Admin** öffnet `http://localhost:3000/admin`, lädt eine CSV-Datei hoch und
   startet das Quiz.
2. **Spieler** rufen `http://localhost:3000/player` (im selben Netzwerk) auf,
   wählen einen Namen und beantworten danach Fragen in Echtzeit.
3. **Scoreboard** (optional) läuft auf `http://localhost:3000/scoreboard` und
   zeigt dauerhaft die Live- bzw. Finalrangliste, z. B. für einen Beamer.

Während des Quiz vergibt der Server pro richtiger Antwort einen Punkt.
Mehrfachantworten auf dieselbe Frage werden blockiert. Nach der letzten Frage
endet das Quiz automatisch, der Admin bekommt eine sortierte Rangliste sowie
eine Fragenanalyse (Quote korrekt/gesamt); Spieler sehen ihr persönliches
Ergebnis.

## Entwicklung & Anpassung
- Styles befinden sich gebündelt in `public/styles.css` und lassen sich leicht
  erweitern.
- Die Socket-Events und Rollen (`admin`, `player`, `scoreboard`) laufen in
  `server.js` zusammen. Weitere Rollen oder Statistiken können dort ergänzt
  werden.
- Für CSV-Validierung oder andere Punkte (z. B. mehr falsche Antworten) können
  die Parsing-Regeln in `server.js` angepasst werden.

Viel Spass beim Ausprobieren!
