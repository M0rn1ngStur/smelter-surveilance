import 'dotenv/config';
import { initDb } from './db';
import { initializeSmelterInstance } from './smelter';
import { initRecorder } from './recorder';
import { initGemini } from './gemini';
import { app } from './routes';

async function run() {
  initDb();
  initRecorder();
  initGemini();

  await initializeSmelterInstance();

  app.listen(3000, () => {
    console.log('Server listening on http://localhost:3000');
  });
}

void run();
