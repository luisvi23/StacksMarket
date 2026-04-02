// scripts/clearDatabase.js
/* eslint-disable no-console */
const mongoose = require("mongoose");
const readline = require("readline");
const User = require("../models/User");
const Poll = require("../models/Poll");
const Trade = require("../models/Trade");
const Comment = require("../models/Comment");
const MarketConfig = require("../models/MarketConfig");
require("dotenv").config();

// ==== MongoDB Connection ====
const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/stacksmarket";

// ==== User Confirmation Prompt ====
function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}

// ==== Clear Database Function ====
async function clearDatabase() {
  try {
    console.log("\n🚨 WARNING: DATABASE CLEAR OPERATION 🚨\n");
    console.log("This will permanently delete ALL data from the following collections:");
    console.log("  - Users");
    console.log("  - Polls");
    console.log("  - Trades");
    console.log("  - Comments");
    console.log("  - MarketConfig");
    console.log("\nConnected to:", MONGO_URI);
    console.log("\n⚠️  THIS ACTION CANNOT BE UNDONE! ⚠️\n");

    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log("✓ MongoDB connected successfully\n");

    // Ask for confirmation
    const confirmed = await askConfirmation(
      'Type "yes" or "y" to proceed with clearing the database: '
    );

    if (!confirmed) {
      console.log("\n❌ Operation cancelled by user");
      process.exit(0);
    }

    console.log("\n🔄 Starting database clear operation...\n");

    // Delete all documents from each collection
    const results = {
      users: await User.deleteMany({}),
      polls: await Poll.deleteMany({}),
      trades: await Trade.deleteMany({}),
      comments: await Comment.deleteMany({}),
      marketConfigs: await MarketConfig.deleteMany({}),
    };

    // Display results
    console.log(" Database cleared successfully!\n");
    console.log("📊 Deletion Summary:");
    console.log(`  - Users deleted: ${results.users.deletedCount}`);
    console.log(`  - Polls deleted: ${results.polls.deletedCount}`);
    console.log(`  - Trades deleted: ${results.trades.deletedCount}`);
    console.log(`  - Comments deleted: ${results.comments.deletedCount}`);
    console.log(`  - MarketConfigs deleted: ${results.marketConfigs.deletedCount}`);
    console.log(
      `\n📈 Total documents deleted: ${
        results.users.deletedCount +
        results.polls.deletedCount +
        results.trades.deletedCount +
        results.comments.deletedCount +
        results.marketConfigs.deletedCount
      }\n`
    );

    console.log("✨ Database is now empty and ready for fresh data!\n");

    // Close connection
    await mongoose.connection.close();
    console.log("✓ MongoDB connection closed");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error clearing database:", error);
    process.exit(1);
  }
}

// ==== Clear Specific Collections Function ====
async function clearSpecificCollections(collections) {
  try {
    console.log("\n🔄 Clearing specific collections...\n");

    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);

    const results = {};

    if (collections.includes("users")) {
      results.users = await User.deleteMany({});
      console.log(`✓ Users cleared: ${results.users.deletedCount} deleted`);
    }

    if (collections.includes("polls")) {
      results.polls = await Poll.deleteMany({});
      console.log(`✓ Polls cleared: ${results.polls.deletedCount} deleted`);
    }

    if (collections.includes("trades")) {
      results.trades = await Trade.deleteMany({});
      console.log(`✓ Trades cleared: ${results.trades.deletedCount} deleted`);
    }

    if (collections.includes("comments")) {
      results.comments = await Comment.deleteMany({});
      console.log(`✓ Comments cleared: ${results.comments.deletedCount} deleted`);
    }

    if (collections.includes("marketconfigs")) {
      results.marketConfigs = await MarketConfig.deleteMany({});
      console.log(`✓ MarketConfigs cleared: ${results.marketConfigs.deletedCount} deleted`);
    }

    console.log("\n Selected collections cleared successfully!\n");

    // Close connection
    await mongoose.connection.close();
    console.log("✓ MongoDB connection closed");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error clearing collections:", error);
    process.exit(1);
  }
}

// ==== Clear All Except Admin Function ====
async function clearExceptAdmin() {
  try {
    console.log("\n🔄 Clearing database (preserving admin user)...\n");

    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);

    // Delete all data except admin user
    const results = {
      users: await User.deleteMany({ isAdmin: false }),
      polls: await Poll.deleteMany({}),
      trades: await Trade.deleteMany({}),
      comments: await Comment.deleteMany({}),
      marketConfigs: await MarketConfig.deleteMany({}),
    };

    console.log(" Database cleared (admin preserved)!\n");
    console.log("📊 Deletion Summary:");
    console.log(`  - Non-admin users deleted: ${results.users.deletedCount}`);
    console.log(`  - Polls deleted: ${results.polls.deletedCount}`);
    console.log(`  - Trades deleted: ${results.trades.deletedCount}`);
    console.log(`  - Comments deleted: ${results.comments.deletedCount}`);
    console.log(`  - MarketConfigs deleted: ${results.marketConfigs.deletedCount}`);

    // Close connection
    await mongoose.connection.close();
    console.log("\n✓ MongoDB connection closed");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error clearing database:", error);
    process.exit(1);
  }
}

// ==== Command Line Arguments Handling ====
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
📚 StacksMarket Database Clear Script
=====================================

Usage:
  node clearDatabase.js [options]

Options:
  --all              Clear all collections (requires confirmation)
  --keep-admin       Clear all data but preserve admin user
  --collections      Clear specific collections (comma-separated)
                     Example: --collections=users,trades
  --force            Skip confirmation prompt (use with caution!)
  -h, --help         Show this help message

Examples:
  node clearDatabase.js --all
  node clearDatabase.js --keep-admin
  node clearDatabase.js --collections=trades,comments
  node clearDatabase.js --all --force

Available Collections:
  - users
  - polls
  - trades
  - comments
  - marketconfigs
  `);
  process.exit(0);
}

// ==== Main Execution ====
(async () => {
  try {
    if (args.includes("--keep-admin")) {
      await clearExceptAdmin();
    } else if (args.includes("--collections")) {
      const collectionsArg = args.find((arg) => arg.startsWith("--collections="));
      if (!collectionsArg) {
        console.error("❌ Error: --collections requires a value");
        console.log('Example: --collections=users,trades');
        process.exit(1);
      }
      const collections = collectionsArg
        .split("=")[1]
        .split(",")
        .map((c) => c.trim().toLowerCase());
      await clearSpecificCollections(collections);
    } else if (args.includes("--all") || args.length === 0) {
      await clearDatabase();
    } else {
      console.log('Invalid arguments. Use --help for usage information.');
      process.exit(1);
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
