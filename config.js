const APP_VERSION = "1.0";

// Größenlimit pro hochgeladener Datei — muss zum Worker-Cap (admin-worker.js) passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const APP_CHANGELOG = [
  {
    version: "1.0",
    groups: [
      {
        title: "Digitaler Stempel",
        items: [
          "PDF hochladen, Stempel-Bild frei positionieren, skalieren, drehen und in der Deckkraft anpassen — anwendbar auf alle, nur die aktuelle oder bestimmte ausgewählte Seiten.",
          "Neben PDF kann auch eine Word-Datei (.docx) gestempelt werden: Ergebnis bleibt eine bearbeitbare .docx-Datei mit direkt eingebettetem Stempelbild (frei positionierbar, drehbar, Deckkraft einstellbar). Bei Word gibt es nur „Alle Seiten“ (Stempel in der Kopfzeile, wiederholt sich automatisch) oder „Nur erste Seite“.",
          "Geteilte Stempelbild-Bibliothek: Stempelbilder werden einmalig mit Namen hinterlegt (PNG mit transparentem Hintergrund empfohlen, auch JPG möglich) — beim Stempeln reicht danach ein Klick auf den Namen statt jedes Mal eine Datei auszuwählen. Hinzufügen kann jeder berechtigte Nutzer, Löschen ist Admins vorbehalten.",
          "Jedes gestempelte Dokument wird automatisch im Vereins-Archiv abgelegt: wer es gestempelt hat und wann, sowie wer es wann heruntergeladen hat. Admins können einzelne Archiv-Dokumente löschen.",
          "Nur für berechtigte Nutzer sichtbar — Anmeldung über die Tools-Übersicht."
        ]
      }
    ]
  }
];
