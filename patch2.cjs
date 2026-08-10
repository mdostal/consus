const fs = require('fs');
let code = fs.readFileSync('server/index.ts', 'utf-8');
code = code.replace(
  'import { registerAttachmentRoutes } from "./routes/attachments.js";',
  'import { registerAttachmentRoutes } from "./routes/attachments.js";\nimport { epicsRoutes } from "./routes/epics.js";'
);
code = code.replace(
  'registerAttachmentRoutes(app, { db, storageAdapter: finalStorageAdapter });',
  'registerAttachmentRoutes(app, { db, storageAdapter: finalStorageAdapter });\n  app.register(epicsRoutes, { prefix: "/api/epics", client, repos });'
);
fs.writeFileSync('server/index.ts', code);
