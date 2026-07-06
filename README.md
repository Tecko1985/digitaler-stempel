# Digitaler Stempel (v1.0)

Web-App des **1. SC 1911 e.V. Heilbad Heiligenstadt** zum digitalen Stempeln von
PDF-Dokumenten und Bildern — direkt im Browser, ohne Umweg über Drucker/Scanner.
Teil der [Tools-Übersicht](https://tecko1985.github.io/ToolsUebersicht/).

**Live:** https://tecko1985.github.io/digitaler-stempel/

## Funktionen

- **Stempeln** — PDF hochladen, Stempel-Bild frei positionieren, skalieren, drehen
  und in der Deckkraft anpassen. Anwendbar auf alle Seiten, nur die aktuelle Seite
  oder bestimmte ausgewählte Seiten.
- **Stempelbild-Bibliothek** — Stempelbilder werden einmalig mit Namen hinterlegt
  (PNG mit transparentem Hintergrund empfohlen, auch JPG möglich). Beim Stempeln
  reicht danach ein Klick auf den Namen statt jedes Mal eine Datei auszuwählen.
  Hinzufügen kann jeder berechtigte Nutzer, Löschen ist Admins vorbehalten.
- **Archiv & Audit-Trail** — jedes gestempelte Dokument wird automatisch im
  Vereins-Archiv abgelegt: wer es gestempelt hat und wann, sowie wer es wann
  heruntergeladen hat. Admins können einzelne Archiv-Dokumente löschen.
- **Zugriff** — nur für berechtigte Nutzer sichtbar, Anmeldung über die
  Tools-Übersicht.

## Technik

Vanilla-JS-App (kein Build-Step). PDF-Rendering/-Bearbeitung clientseitig über
[pdf.js](https://mozilla.github.io/pdf.js/) (Anzeige) und
[pdf-lib](https://pdf-lib.js.org/) (Stempel einbetten, neues PDF erzeugen).
Anmeldung, Stempelbild-Bibliothek und Archiv laufen über das zentrale
ToolsUebersicht-Login-Gateway (`db.js`), das die Dateien serverseitig per WebDAV
in der Vereins-Nextcloud ablegt — kein separates Passwort im Client.

- `index.html`, `app.js`, `db.js`, `config.js`, `style.css` — die App

## Lokal starten

`E:\.claude\launch.json` → Eintrag `digitaler-stempel` (Port 8794).
