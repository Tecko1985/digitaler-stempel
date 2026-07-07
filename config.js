const APP_VERSION = "1.1";

// Größenlimit pro hochgeladener Datei — muss zum Worker-Cap (admin-worker.js) passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const APP_CHANGELOG = [
  {
    version: "1.1",
    groups: [
      {
        title: "Word-Dateien stempeln",
        items: [
          "Neben PDF kann jetzt auch eine Word-Datei (.docx) gestempelt werden — eigener Auswahl-Button direkt neben dem PDF-Feld.",
          "Ergebnis bleibt eine bearbeitbare .docx-Datei: das Stempelbild wird direkt in das Word-Dokument eingebettet (frei positionierbar, drehbar, Deckkraft einstellbar — wie bei PDF).",
          "Da Word den Text erst beim Öffnen selbst umbricht, gibt es bei Word-Dateien nur zwei Seiten-Optionen: „Alle Seiten“ (Stempel in der Kopfzeile, wiederholt sich automatisch auf jeder Seite) oder „Nur erste Seite“ — kein gezieltes Stempeln einzelner Seiten mitten im Dokument."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Digitaler Stempel",
        items: [
          "PDF hochladen, Stempel-Bild frei positionieren, skalieren, drehen und in der Deckkraft anpassen — anwendbar auf alle, nur die aktuelle oder bestimmte ausgewählte Seiten.",
          "Geteilte Stempelbild-Bibliothek: Stempelbilder werden einmalig mit Namen hinterlegt (PNG mit transparentem Hintergrund empfohlen, auch JPG möglich) — beim Stempeln reicht danach ein Klick auf den Namen statt jedes Mal eine Datei auszuwählen. Hinzufügen kann jeder berechtigte Nutzer, Löschen ist Admins vorbehalten.",
          "Jedes gestempelte Dokument wird automatisch im Vereins-Archiv abgelegt: wer es gestempelt hat und wann, sowie wer es wann heruntergeladen hat. Admins können einzelne Archiv-Dokumente löschen.",
          "Nur für berechtigte Nutzer sichtbar — Anmeldung über die Tools-Übersicht."
        ]
      }
    ]
  }
];
