const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const app = express();
const { initializeDatabase, checkSimAvailability, validatePhoneNumber, checkPhoneAvailability, registerPhoneNumber, registerSubscriber } = require('./database.js');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/faceRecognitionApp')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    idNumber: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    surname: { type: String, required: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Initialize SIM/HSS Database
async function startServer() {
    try {
        await initializeDatabase();
        console.log('SIM/HSS database initialized');
    } catch (err) {
        console.error('Failed to initialize SIM/HSS database:', err);
        process.exit(1); // Exit if database initialization fails
    }
}

// Routes
app.get('/', isAuthenticated, async (req, res) => {
    try {
        res.render('index', { req });
    } catch (error) {
        console.error('Error rendering index:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/register', async (req, res) => {
    try {
        const { idNumber, name, surname, password } = req.body;
        
        const existingUser = await User.findOne({ idNumber });
        if (existingUser) {
            return res.render('register', { error: 'ID number already registered' });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const user = new User({
            idNumber,
            name,
            surname,
            password: hashedPassword
        });

        await user.save();
        res.redirect('/login');
    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', { error: 'Registration failed. Please try again.' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { idNumber, password } = req.body;
        
        const user = await User.findOne({ idNumber });
        if (!user) {
            return res.render('login', { error: 'Invalid ID number or password' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.render('login', { error: 'Invalid ID number or password' });
        }

        req.session.userId = user._id;
        req.session.idNumber = user.idNumber;
        req.session.name = user.name;
        req.session.surname = user.surname;
        console.log('Session set:', req.session);

        res.redirect('/');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'Login failed. Please try again.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Error logging out');
        }
        res.redirect('/login');
    });
});

// New Routes for Post-Verification Screens
app.get('/options', isAuthenticated, async (req, res) => {
    try {
        res.render('options', { req });
    } catch (error) {
        console.error('Error rendering options:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/register-screen', isAuthenticated, async (req, res) => {
    try {
        res.render('register-screen', { req });
    } catch (error) {
        console.error('Error rendering register-screen:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/sim-swap-screen', isAuthenticated, async (req, res) => {
    try {
        res.render('sim-swap-screen', { req });
    } catch (error) {
        console.error('Error rendering sim-swap-screen:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/manage-numbers', isAuthenticated, async (req, res) => {
    try {
        const db = await initializeDatabase();
        const hssSubscribers = db.collection('hssSubscribers');
        const subscriber = await hssSubscribers.findOne({ idNumber: req.session.idNumber });
        const phoneNumbers = subscriber ? subscriber.phoneNumbers : [];
        res.render('manage-numbers', { phoneNumbers, req });
    } catch (error) {
        console.error('Error rendering manage-numbers:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API Endpoints for SIM and HSS Operations
app.post('/api/check-sim', isAuthenticated, async (req, res) => {
    try {
        const { simId } = req.body;
        if (!simId) {
            return res.status(400).json({ error: 'SIM number is required' });
        }
        const sim = await checkSimAvailability(simId);
        if (sim) {
            res.json({ available: true, message: 'SIM is available. Choose a phone number.' });
        } else {
            res.json({ available: false, message: 'SIM not available or invalid.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Error checking SIM: ' + err.message });
    }
});

app.post('/api/register-phone', isAuthenticated, async (req, res) => {
    console.log('Received register-phone request:', req.body);
    const { simId, phoneNumber, names, surname, paymentPlan } = req.body;

    try {
        if (!req.session.idNumber) {
            return res.status(401).json({ error: 'User not authenticated. Please log in again.' });
        }

        const db = await initializeDatabase();
        const sim = await checkSimAvailability(simId);
        if (!sim) {
            return res.status(400).json({ error: 'SIM not available or invalid.' });
        }

        if (!validatePhoneNumber(phoneNumber)) {
            return res.status(400).json({ error: 'Invalid phone number format.' });
        }

        if (!(await checkPhoneAvailability(phoneNumber))) {
            return res.status(400).json({ error: 'Phone number already registered.' });
        }

        await registerPhoneNumber(simId, phoneNumber, paymentPlan || 'Default');
        await registerSubscriber(req.session.idNumber, names || req.session.name, surname || req.session.surname, phoneNumber, paymentPlan || 'Default', true);

        res.json({ message: 'Phone number registered successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sim-swap', isAuthenticated, async (req, res) => {
    const { phoneNumber, newSimId, idNumber } = req.body;

    try {
        if (!phoneNumber || !newSimId || !idNumber) {
            return res.status(400).json({ message: 'Phone number, new SIM ID, and ID number are required.', success: false });
        }

        const db = await initializeDatabase();
        const hssSubscribers = db.collection('hssSubscribers');
        const subscriber = await hssSubscribers.findOne({ idNumber });
        if (!subscriber) {
            return res.status(404).json({ message: 'User not found.', success: false });
        }

        const hasPhone = subscriber.phoneNumbers.some(p => p.phoneNumber === phoneNumber);
        if (!hasPhone) {
            return res.status(403).json({ message: 'You do not own this phone number.', success: false });
        }

        const simNumbers = db.collection('simNumbers');
        const newSim = await checkSimAvailability(newSimId);
        if (!newSim) {
            return res.status(400).json({ message: 'New SIM is not available or invalid.', success: false });
        }

        const oldSim = await simNumbers.findOne({ phoneNumber });
        if (oldSim) {
            await simNumbers.updateOne(
                { simId: oldSim.simId },
                { $set: { isAvailable: true, phoneNumber: null, paymentPlan: null } }
            );
            console.log(`Old SIM ${oldSim.simId} made available again.`);
        }

        const currentPaymentPlan = subscriber.phoneNumbers.find(p => p.phoneNumber === phoneNumber).paymentPlan;
        await simNumbers.updateOne(
            { simId: newSimId },
            { $set: { phoneNumber, isAvailable: false, paymentPlan: currentPaymentPlan } }
        );
        console.log(`New SIM ${newSimId} assigned to phone number ${phoneNumber} with payment plan ${currentPaymentPlan}.`);

        await hssSubscribers.updateOne(
            { idNumber, 'phoneNumbers.phoneNumber': phoneNumber },
            { 
                $set: { 
                    'phoneNumbers.$.simId': newSimId, 
                    'phoneNumbers.$.paymentPlan': currentPaymentPlan,
                    'phoneNumbers.$.isActive': true
                } 
            }
        );
        console.log(`HSS updated for user ${idNumber}: SIM ${newSimId} assigned to phone ${phoneNumber} with payment plan ${currentPaymentPlan}.`);

        const updatedSubscriber = await hssSubscribers.findOne({ idNumber });
        const updatedPhoneEntry = updatedSubscriber.phoneNumbers.find(p => p.phoneNumber === phoneNumber);
        if (updatedPhoneEntry.simId !== newSimId || updatedPhoneEntry.paymentPlan !== currentPaymentPlan) {
            throw new Error('Failed to update SIM or payment plan in HSS.');
        }

        res.json({ message: 'SIM swap successful.', success: true });
    } catch (err) {
        console.error('SIM swap error:', err);
        res.status(500).json({ message: err.message, success: false });
    }
});

app.post('/api/toggle-number', isAuthenticated, async (req, res) => {
    try {
        const { phoneNumber, isActive } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number is required.' });
        }

        const db = await initializeDatabase();
        const hssSubscribers = db.collection('hssSubscribers');
        const subscriber = await hssSubscribers.findOne({ idNumber: req.session.idNumber });
        if (!subscriber) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const phoneIndex = subscriber.phoneNumbers.findIndex(p => p.phoneNumber === phoneNumber);
        if (phoneIndex === -1) {
            return res.status(404).json({ success: false, message: 'Phone number not found.' });
        }

        await hssSubscribers.updateOne(
            { idNumber: req.session.idNumber, 'phoneNumbers.phoneNumber': phoneNumber },
            { $set: { 'phoneNumbers.$.isActive': isActive } }
        );

        res.json({ success: true, message: `Phone number ${phoneNumber} ${isActive ? 'activated' : 'deactivated'} successfully.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating phone status.' });
    }
});

// Start the server after initializing the database
startServer().then(() => {
    const PORT = 3001;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});