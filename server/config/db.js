import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? path.join('/tmp', 'ipet_data') : path.join(__dirname, '..', 'data'));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let isUsingMongo = false;

// Simple file-backed persistent collections if MongoDB is not running locally
class FileCollection {
  constructor(name) {
    this.name = name;
    this.filePath = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]), 'utf-8');
    }
  }

  _read() {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data || '[]');
    } catch {
      return [];
    }
  }

  _write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async find(filter = {}) {
    const items = this._read();
    return items.filter(item => {
      for (const key of Object.keys(filter)) {
        if (filter[key] && typeof filter[key] === 'object' && filter[key].$ne !== undefined) {
          if (item[key] === filter[key].$ne) return false;
        } else if (filter[key] && typeof filter[key] === 'object' && filter[key].$in !== undefined) {
          if (!filter[key].$in.includes(item[key])) return false;
        } else if (filter[key] && typeof filter[key] === 'object' && filter[key].$gt !== undefined) {
          if (new Date(item[key]) <= new Date(filter[key].$gt)) return false;
        } else if (filter[key] && typeof filter[key] === 'object' && filter[key].$lt !== undefined) {
          if (new Date(item[key]) >= new Date(filter[key].$lt)) return false;
        } else if (filter[key] && typeof filter[key] === 'object' && filter[key].$gte !== undefined) {
          if (String(item[key]) < String(filter[key].$gte)) return false;
        } else if (filter[key] && typeof filter[key] === 'object' && filter[key].$lte !== undefined) {
          if (String(item[key]) > String(filter[key].$lte)) return false;
        } else if (item[key] !== filter[key]) {
          return false;
        }
      }
      return true;
    });
  }

  async findOne(filter = {}) {
    const list = await this.find(filter);
    return list.length > 0 ? list[0] : null;
  }

  async findById(id) {
    return this.findOne({ _id: id });
  }

  async create(doc) {
    const items = this._read();
    const newDoc = {
      _id: doc._id || uuidv4(),
      ...doc,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.push(newDoc);
    this._write(items);
    return newDoc;
  }

  async insertMany(docs) {
    const inserted = [];
    for (const doc of docs) {
      inserted.push(await this.create(doc));
    }
    return inserted;
  }

  async findByIdAndUpdate(id, update, options = { new: true }) {
    const items = this._read();
    const idx = items.findIndex(item => item._id === id);
    if (idx === -1) return null;

    const current = items[idx];
    const updateData = update.$set ? { ...current, ...update.$set } : { ...current, ...update };
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        updateData[k] = (updateData[k] || 0) + v;
      }
    }
    updateData.updatedAt = new Date().toISOString();
    items[idx] = updateData;
    this._write(items);
    return options.new ? updateData : current;
  }

  async updateOne(filter, update) {
    const doc = await this.findOne(filter);
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    await this.findByIdAndUpdate(doc._id, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter) {
    const items = this._read();
    const doc = await this.findOne(filter);
    if (!doc) return { deletedCount: 0 };
    const filtered = items.filter(item => item._id !== doc._id);
    this._write(filtered);
    return { deletedCount: 1 };
  }

  async deleteMany(filter) {
    const items = this._read();
    const toDelete = await this.find(filter);
    const toDeleteIds = new Set(toDelete.map(d => d._id));
    const kept = items.filter(item => !toDeleteIds.has(item._id));
    this._write(kept);
    return { deletedCount: toDelete.length };
  }

  async countDocuments(filter = {}) {
    const docs = await this.find(filter);
    return docs.length;
  }
}

class MongoCollection {
  constructor(name, fileFallback) {
    this.name = name;
    this.fileFallback = fileFallback;
  }

  get raw() {
    if (isUsingMongo && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      return mongoose.connection.db.collection(this.name);
    }
    return null;
  }

  async find(filter = {}) {
    const col = this.raw;
    if (col) {
      return await col.find(filter).toArray();
    }
    return this.fileFallback.find(filter);
  }

  async findOne(filter = {}) {
    const col = this.raw;
    if (col) {
      return await col.findOne(filter);
    }
    return this.fileFallback.findOne(filter);
  }

  async findById(id) {
    return this.findOne({ _id: id });
  }

  async create(doc) {
    const newDoc = {
      _id: doc._id || uuidv4(),
      ...doc,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const col = this.raw;
    if (col) {
      await col.insertOne(newDoc);
      return newDoc;
    }
    return this.fileFallback.create(doc);
  }

  async insertMany(docs) {
    const formatted = docs.map(d => ({
      _id: d._id || uuidv4(),
      ...d,
      createdAt: d.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    const col = this.raw;
    if (col) {
      if (formatted.length > 0) await col.insertMany(formatted);
      return formatted;
    }
    return this.fileFallback.insertMany(docs);
  }

  async findByIdAndUpdate(id, update, options = { new: true }) {
    const col = this.raw;
    if (col) {
      const updateDoc = update.$set || update.$inc ? update : { $set: update };
      if (!updateDoc.$set) updateDoc.$set = {};
      updateDoc.$set.updatedAt = new Date().toISOString();
      const res = await col.findOneAndUpdate(
        { _id: id },
        updateDoc,
        { returnDocument: options.new !== false ? 'after' : 'before' }
      );
      return res;
    }
    return this.fileFallback.findByIdAndUpdate(id, update, options);
  }

  async updateOne(filter, update) {
    const col = this.raw;
    if (col) {
      const updateDoc = update.$set || update.$inc ? update : { $set: update };
      return await col.updateOne(filter, updateDoc);
    }
    return this.fileFallback.updateOne(filter, update);
  }

  async deleteOne(filter) {
    const col = this.raw;
    if (col) {
      return await col.deleteOne(filter);
    }
    return this.fileFallback.deleteOne(filter);
  }

  async deleteMany(filter) {
    const col = this.raw;
    if (col) {
      return await col.deleteMany(filter);
    }
    return this.fileFallback.deleteMany(filter);
  }

  async countDocuments(filter = {}) {
    const col = this.raw;
    if (col) {
      return await col.countDocuments(filter);
    }
    return this.fileFallback.countDocuments(filter);
  }
}

const collections = {};
export function getCollection(name) {
  if (!collections[name]) {
    const fileFallback = new FileCollection(name);
    collections[name] = new MongoCollection(name, fileFallback);
  }
  return collections[name];
}

async function autoSeedMongoIfEmpty() {
  if (!isUsingMongo || mongoose.connection.readyState !== 1 || !mongoose.connection.db) return;
  const db = mongoose.connection.db;
  const seedFiles = [
    'users', 'pets', 'memories', 'worlds', 'messages',
    'pet_emotions', 'pet_growth', 'friends', 'surprises',
    'diary_entries', 'roadmap_tasks', 'game_sessions', 'study_sessions'
  ];

  for (const name of seedFiles) {
    try {
      const col = db.collection(name);
      const count = await col.countDocuments();
      if (count === 0) {
        const filePath = path.join(DATA_DIR, `${name}.json`);
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw || '[]');
          if (Array.isArray(data) && data.length > 0) {
            await col.insertMany(data);
            console.log(`🌱 [Database] Seeded ${data.length} records into MongoDB collection: ${name}`);
          }
        }
      }
    } catch (seedErr) {
      console.warn(`⚠️ [Database] Auto-seed error for ${name}:`, seedErr.message);
    }
  }
}

export async function connectDB() {
  const mongoURI = process.env.MONGODB_URI;
  if (mongoURI) {
    try {
      console.log(`[Database] Attempting connection to MongoDB at: ${mongoURI}`);
      await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 });
      isUsingMongo = true;
      console.log('✅ [Database] Successfully connected to MongoDB server');
      await autoSeedMongoIfEmpty();
      return true;
    } catch (err) {
      console.warn('⚠️ [Database] Could not connect to remote MongoDB. Switching seamlessly to Local Persistent JSON Store.');
      isUsingMongo = false;
      return false;
    }
  } else {
    console.log('ℹ️ [Database] MONGODB_URI not set. Using High-Performance Local Persistent JSON Store (data directory: server/data)');
    isUsingMongo = false;
    return false;
  }
}

export function getStorageMode() {
  return isUsingMongo ? 'mongodb' : 'json_file';
}

export { isUsingMongo };

