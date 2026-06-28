import express from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { document } from './spec';

const app = express();
const PORT = 1778;

app.use('/', apiReference({ spec: { content: document }, darkMode: false }));

app.listen(PORT, () => {
    console.log(`Sales Sync API docs running at http://localhost:${PORT}`);
});
