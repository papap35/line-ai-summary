import 'dotenv/config';
import { runDailySummary } from './scheduler.js';

runDailySummary()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
