# StacksMarket Database Scripts

This directory contains utility scripts for managing the StacksMarket database.

## 📜 Available Scripts

### 1. Clear Database Script (`clearDatabase.js`)

A powerful and flexible script for clearing the MongoDB database with multiple options.

#### 🚀 Quick Start

**Clear all data (with confirmation):**
```bash
cd server
npm run db:clear
```

**Clear all data except admin user:**
```bash
npm run db:clear:keep-admin
```

**Clear specific collection (trades only):**
```bash
npm run db:clear:trades
```

**Clear specific collection (comments only):**
```bash
npm run db:clear:comments
```

#### 📖 Detailed Usage

**Command Line Interface:**
```bash
node scripts/clearDatabase.js [options]
```

**Available Options:**

| Option | Description | Example |
|--------|-------------|---------|
| `--all` | Clear all collections (requires confirmation) | `node scripts/clearDatabase.js --all` |
| `--keep-admin` | Clear all data but preserve admin user | `node scripts/clearDatabase.js --keep-admin` |
| `--collections` | Clear specific collections (comma-separated) | `node scripts/clearDatabase.js --collections=users,trades` |
| `--force` | Skip confirmation prompt (use with caution!) | `node scripts/clearDatabase.js --all --force` |
| `-h, --help` | Show help message | `node scripts/clearDatabase.js --help` |

#### 📦 Available Collections

- `users` - All user accounts
- `polls` - All market polls
- `trades` - All trade transactions
- `comments` - All comments and replies
- `marketconfigs` - Market configuration data

#### 💡 Common Use Cases

**1. Fresh Start (Keep Admin)**
```bash
npm run db:clear:keep-admin
```
Perfect for development when you want to clear all data but keep your admin account.

**2. Clear Trading Data Only**
```bash
node scripts/clearDatabase.js --collections=trades
```
Useful when you want to reset trades but keep users and polls.

**3. Clear Multiple Collections**
```bash
node scripts/clearDatabase.js --collections=trades,comments
```
Clear multiple collections at once.

**4. Nuclear Option (Everything)**
```bash
npm run db:clear
```
Completely wipe the database. Requires confirmation.

**5. Automated Clearing (CI/CD)**
```bash
node scripts/clearDatabase.js --all --force
```
Skip confirmation prompt for automated scripts (be careful!).

#### ⚠️ Safety Features

1. **Confirmation Prompt**: By default, the script asks for confirmation before clearing data
2. **Connection Validation**: Verifies MongoDB connection before proceeding
3. **Clear Summary**: Displays how many documents were deleted from each collection
4. **Error Handling**: Gracefully handles errors and provides clear error messages

#### 📊 Example Output

```
🚨 WARNING: DATABASE CLEAR OPERATION 🚨

This will permanently delete ALL data from the following collections:
  - Users
  - Polls
  - Trades
  - Comments
  - MarketConfig

Connected to: mongodb://localhost:27017/stacksmarket

⚠️  THIS ACTION CANNOT BE UNDONE! ⚠️

Type "yes" or "y" to proceed with clearing the database: yes

🔄 Starting database clear operation...

 Database cleared successfully!

📊 Deletion Summary:
  - Users deleted: 150
  - Polls deleted: 42
  - Trades deleted: 1247
  - Comments deleted: 89
  - MarketConfigs deleted: 5

📈 Total documents deleted: 1533

✨ Database is now empty and ready for fresh data!

✓ MongoDB connection closed
```

---

### 2. Populate Data Script (`populateData.js`)

Seeds the database with sample data for development and testing.

#### 🚀 Usage

```bash
cd server
npm run populate
```

#### 📦 What It Creates

- Admin user account
- 5 test user accounts
- Sample polls across all categories (Politics, Sports, Crypto, Tech, etc.)
- Historical trade data for realistic charts
- Market statistics and trending data

#### 🔄 Combined Workflow

**Full Database Reset:**
```bash
# Clear everything
npm run db:clear

# Populate with fresh data
npm run populate
```

**Keep Admin, Refresh Data:**
```bash
# Clear everything except admin
npm run db:clear:keep-admin

# Populate with fresh data
npm run populate
```

---

## 🔧 Environment Configuration

Both scripts use the MongoDB connection string from your environment:

```env
MONGODB_URI=mongodb://localhost:27017/stacksmarket
```

If not set, defaults to `mongodb://localhost:27017/stacksmarket`

---

## 🛡️ Best Practices

1. **Always backup production data** before running clear scripts
2. **Never use `--force`** in production environments
3. **Use `--keep-admin`** during development to preserve your admin account
4. **Test scripts on local/dev environment** before production use
5. **Review deletion summary** after running to verify expected results

---

## 🐛 Troubleshooting

**Connection Issues:**
```
Error: MongoDB connection error
```
- Verify MongoDB is running: `mongod --version`
- Check MONGODB_URI in `.env` file
- Ensure MongoDB service is started

**Permission Errors:**
```
Error: unauthorized
```
- Check MongoDB authentication credentials
- Verify user has deleteMany permissions

**Collection Not Found:**
```
Collection 'xyz' not found
```
- Check collection name spelling (use lowercase)
- Available: users, polls, trades, comments, marketconfigs

---

## 📝 Notes

- All operations are logged to console with clear status indicators
- Scripts automatically close MongoDB connection after completion
- Exit codes: 0 (success), 1 (error/cancelled)
- Safe to run multiple times - idempotent operations

---

## 🤝 Contributing

When adding new collections to the database, remember to:
1. Update the `clearDatabase.js` script
2. Add the model import
3. Add deletion logic in the main function
4. Update this README with the new collection name

---

## 📞 Support

For issues or questions:
- Check the help menu: `node scripts/clearDatabase.js --help`
- Review MongoDB logs for connection issues
- Ensure all dependencies are installed: `npm install`

---

### 3. Backfill On-Chain Odds (`backfillOnChainOdds.js`)

Recomputes binary poll percentages from on-chain `get-market-snapshot` so backend odds align with chain state.

#### Usage

```bash
cd server
npm run odds:backfill
```

Optional flags:

- `--poll=<pollId>`: process one poll only.
- `--market-id=<id>`: process one market id only.
- `--limit=<n>`: max polls (default: 500).
- `--timeout-ms=<n>`: Hiro timeout per poll (default: 10000).

Examples:

```bash
npm run odds:backfill -- --poll=67c1234567890abcde123456
npm run odds:backfill -- --market-id=42
```

---

**Created for:** StacksMarket Full-Stack Application  
**Last Updated:** October 2025
