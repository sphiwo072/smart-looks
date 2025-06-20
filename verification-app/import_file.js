const mongoose = require('mongoose');
const XLSX = require('xlsx');
const chokidar = require('chokidar');
const path = require('path');

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/id_profiles', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Connection error:'));
db.once('open', () => console.log('Connected to MongoDB!'));

// Define MongoDB Schema
const profileSchema = new mongoose.Schema({
  id_number: { type: String, unique: true },
  name: String,
  surname: String,
  date_of_birth: String, // Store as string in "dd/mm/yyyy" format
  id_photo: String,
  chief_code: String,
});

const Profile = mongoose.model('profiles', profileSchema);

// Path to the Excel file
const filePath = path.join(__dirname, 'ID_Profiles.xlsx');

// Function to convert Excel serial number to "dd/mm/yyyy" format
const excelSerialToDate = (serial) => {
  const utc_days = Math.floor(serial - 25569); // Adjust for Excel's 1900 epoch
  const date = new Date(utc_days * 86400 * 1000); // Convert to milliseconds
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

// Function to Read & Import Data
const importData = () => {
  console.log('Reading Excel file...');
  const workbook = XLSX.readFile(filePath, { dateNF: 'dd/mm/yyyy' }); // Hint format
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { raw: false }); // Use formatted values

  data.forEach(async (entry) => {
    try {
      // If date_of_birth is still a serial number, convert it
      let dateOfBirth = entry.date_of_birth;
      if (typeof dateOfBirth === 'number') {
        dateOfBirth = excelSerialToDate(dateOfBirth);
      }

      // Ensure the entry has the corrected date
      const updatedEntry = { ...entry, date_of_birth: dateOfBirth };

      // Upsert: Update if exists, otherwise insert new
      await Profile.updateOne(
        { id_number: entry.id_number },
        { $set: updatedEntry },
        { upsert: true }
      );
      console.log(`Updated/Inserted: ${entry.id_number}`);
    } catch (error) {
      console.error('Error inserting data:', error);
    }
  });
};

// Watch for Changes
chokidar.watch(filePath).on('change', () => {
  console.log('Excel file changed! Updating MongoDB...');
  importData();
});

// Run Once on Start
importData();