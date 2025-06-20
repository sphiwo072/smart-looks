const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017'; // Update with your MongoDB URI
const dbName = 'faceRecognition'; // Update with your database name
let db;

async function connectToDatabase() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        db = client.db(dbName);
        console.log('Connected to MongoDB');

        // Initialize simNumbers collection with sample data
        const simNumbers = db.collection('simNumbers');
        const existingSims = await simNumbers.countDocuments();
        if (existingSims === 0) {
            await simNumbers.insertMany([
                { simId: 'SIM1234567890', phoneNumber: null, isAvailable: true, paymentPlan: null },
                { simId: 'SIM9876543210', phoneNumber: null, isAvailable: true, paymentPlan: null },
                { simId: 'SIM5555555555', phoneNumber: null, isAvailable: true, paymentPlan: null }
            ]);
            console.log('Initialized simNumbers with sample data');
        }

        // Ensure hssSubscribers collection exists
        await db.createCollection('hssSubscribers');
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        throw err;
    }
    return db;
}

async function initializeDatabase() {
    if (!db) {
        db = await connectToDatabase();
    }
    return db;
}

async function checkSimAvailability(simId) {
    const simNumbers = db.collection('simNumbers');
    return await simNumbers.findOne({ simId, isAvailable: true });
}

function validatePhoneNumber(phoneNumber) {
    const phoneRegex = /^\+2687[68]\d{6}$/;
    return phoneRegex.test(phoneNumber) && phoneNumber.length === 12;
}

async function checkPhoneAvailability(phoneNumber) {
    const simNumbers = db.collection('simNumbers');
    const hssSubscribers = db.collection('hssSubscribers');
    const existingSim = await simNumbers.findOne({ phoneNumber });
    const existingSubscriber = await hssSubscribers.findOne({ 'phoneNumbers.phoneNumber': phoneNumber });
    return !existingSim && !existingSubscriber;
}

async function registerPhoneNumber(simId, phoneNumber, paymentPlan) {
    const simNumbers = db.collection('simNumbers');
    const result = await simNumbers.updateOne(
        { simId, isAvailable: true },
        { $set: { phoneNumber, isAvailable: false, paymentPlan } }
    );
    if (result.matchedCount === 0) {
        throw new Error('SIM not available or invalid');
    }
}

async function registerSubscriber(idNumber, names, surname, phoneNumber, paymentPlan, isActive = true) {
    const hssSubscribers = db.collection('hssSubscribers');
    console.log(`Registering subscriber ${idNumber} with phone ${phoneNumber}, paymentPlan: ${paymentPlan}`); // Debug log
    const simId = await getSimIdForPhone(phoneNumber);
    const simNumbers = db.collection('simNumbers');
    const sim = await simNumbers.findOne({ simId });
    const isAvailable = sim ? sim.isAvailable : false;

    const subscriber = await hssSubscribers.findOne({ idNumber });
    if (subscriber) {
        const phoneNumbers = subscriber.phoneNumbers || [];
        const existingPhoneIndex = phoneNumbers.findIndex(p => p.phoneNumber === phoneNumber);
        if (existingPhoneIndex === -1) {
            const newPhoneEntry = { 
                phoneNumber, 
                paymentPlan: paymentPlan || 'Default', 
                simId, 
                //isAvailable,
                isActive // Add isActive to each phone entry
            };
            await hssSubscribers.updateOne(
                { idNumber },
                { 
                    $push: { phoneNumbers: newPhoneEntry },
                    $set: { names, surname } // Update names and surname
                }
            );
        } else {
            if (phoneNumbers[existingPhoneIndex].paymentPlan !== paymentPlan) {
                await hssSubscribers.updateOne(
                    { idNumber, 'phoneNumbers.phoneNumber': phoneNumber },
                    { 
                        $set: { 
                            'phoneNumbers.$.paymentPlan': paymentPlan || 'Default',
                            'phoneNumbers.$.isAvailable': isAvailable,
                            'phoneNumbers.$.isActive': isActive // Update isActive
                        }
                    }
                );
            }
        }
    } else {
        const initialPhoneEntry = { 
            phoneNumber, 
            paymentPlan: paymentPlan || 'Default', 
            simId, 
            //isAvailable,
            isActive // Add isActive to new entry
        };
        await hssSubscribers.insertOne({
            idNumber,
            names,
            surname,
            phoneNumbers: [initialPhoneEntry]
        });
    }
}

async function getSimIdForPhone(phoneNumber) {
    const simNumbers = db.collection('simNumbers');
    const sim = await simNumbers.findOne({ phoneNumber });
    return sim ? sim.simId : null;
}

module.exports = {
    initializeDatabase,
    checkSimAvailability,
    validatePhoneNumber,
    checkPhoneAvailability,
    registerPhoneNumber,
    registerSubscriber,
    getSimIdForPhone
};