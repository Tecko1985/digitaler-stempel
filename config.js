const APP_VERSION = "1.1";

// Größenlimit pro hochgeladener Datei — muss zum Worker-Cap (admin-worker.js) passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const APP_CHANGELOG = [
  {
    version: "1.1",
    groups: [
      {
        title: "Stempel-Bibliothek & Archiv-Verwaltung",
        items: [
          "Stempelbilder werden jetzt einmalig mit Namen hinterlegt — beim Stempeln reicht ein Klick auf den Namen statt jedes Mal eine Datei auszuwählen.",
          "Admins können einzelne Archiv-Dokumente und hinterlegte Stempelbilder löschen."
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
          "PDF hochladen, Stempel-Bild frei positionieren, skalieren, drehen und in der Deckkraft anpassen — anwendbar auf alle, nur die aktuelle oder ausgewählte Seiten.",
          "Jedes gestempelte Dokument wird automatisch im Vereins-Archiv abgelegt: wer es gestempelt hat und wann, sowie wer es wann heruntergeladen hat.",
          "Nur für berechtigte Nutzer sichtbar — Anmeldung über die Tools-Übersicht."
        ]
      }
    ]
  }
];
