// Gives an existing account admin rights:   npm run make-admin -- you@example.com
// Take them away again with:                npm run make-admin -- you@example.com --remove
//
// For the live site, run it with the live database's connection string in
// MONGO_URI (see DEPLOY.md, step 5). Without it, your local database is used.
import mongoose from 'mongoose';
import { config } from './config.js';
import { User } from './models.js';

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run make-admin -- <email> [--remove]');
  process.exit(1);
}

// Says what is wrong with the connection string without printing it.
function describe(uri) {
  const facts = [
    `${uri.length} characters`,
    uri.includes('mongodb+srv://') || uri.includes('mongodb://') ? 'contains mongodb+srv://' : 'does NOT contain mongodb+srv:// anywhere',
    /^mongodb(\+srv)?:\/\//.test(uri) ? 'starts correctly' : 'does not start with mongodb+srv://',
  ];
  return `The connection string you gave: ${facts.join(', ')}.`;
}

const live = !config.mongoUri.startsWith('mongodb://127.0.0.1');
console.log(live ? 'Connecting to the live database…' : 'Connecting to the local database on this computer…');
try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
} catch (err) {
  console.error(`Could not connect: ${err.message}`);
  console.error(describe(config.mongoUri));
  console.error('Copy the whole line again (it should begin with mongodb+srv://layerforge_app:) and paste it once.');
  process.exit(1);
}

const isAdmin = flag !== '--remove';
const user = await User.findOneAndUpdate({ email: String(email).trim().toLowerCase() }, { $set: { isAdmin } });
console.log(
  user
    ? `${user.email} is ${isAdmin ? 'now an admin' : 'no longer an admin'}. Log out and back in on the site to see the Admin page.`
    : `No account found for ${email}. Create the account on the website first, then run this again.`
);
await mongoose.disconnect();
process.exit(user ? 0 : 1);
