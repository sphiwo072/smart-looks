#!/usr/bin/env python
# coding: utf-8



from flask import Flask, request, jsonify
import face_recognition
from flask_cors import CORS
import numpy as np
import cv2
import os
import logging
from pymongo import MongoClient
import re

app = Flask(__name__)
CORS(app)

# Set up logging
logging.basicConfig(level=logging.DEBUG)

# Connect to MongoDB
client = MongoClient("mongodb://localhost:27017/")
db = client["id_profiles"]
collection = db["profiles"]

def normalize_string(s):
    """Normalize a string by removing extra whitespace and non-printable characters."""
    if not s:
        return ""
    # Remove leading/trailing whitespace and normalize internal spaces
    s = re.sub(r'\s+', ' ', s.strip())
    # Remove non-printable characters (ASCII control characters)
    s = ''.join(char for char in s if ord(char) >= 32 or char in '\n\r\t')
    return s

def get_id_profile(id_number):
    """Retrieve the user profile from MongoDB using the ID number."""
    profile = collection.find_one({"id_number": id_number})
    return profile if profile else None

@app.route('/verify', methods=['POST'])
def compare_faces():
    # Validate required fields
    required_fields = ['captured_image', 'id_number', 'surname', 'name', 'date_of_birth', 'chiefCode']
    for field in required_fields:
        if field not in request.form and field not in request.files:
            return jsonify({"error": f"{field} is required"}), 400

    try:
        id_number = request.form['id_number']
        entered_surname = request.form['surname']
        entered_names = request.form['name']
        entered_dob = request.form['date_of_birth']
        entered_chief_code = request.form['chiefCode']
        
        # Fetch the user profile from MongoDB
        profile = get_id_profile(id_number)
        if not profile:
            return jsonify({"error": "ID number not found in database"}), 404

        id_photo_path = profile.get("id_photo")
        if not id_photo_path or not os.path.exists(id_photo_path):
            return jsonify({"error": "ID photo missing in database"}), 404

        # Extract and normalize profile details
        db_surname = normalize_string(profile.get("surname", ""))
        db_names = normalize_string(profile.get("name", ""))
        db_dob = normalize_string(profile.get("date_of_birth", ""))
        db_chief_code = normalize_string(profile.get("chief_code", ""))

        # Normalize entered details
        entered_surname = normalize_string(entered_surname)
        entered_names = normalize_string(entered_names)
        entered_dob = normalize_string(entered_dob)
        entered_chief_code = normalize_string(entered_chief_code)

        # Log the values for debugging
        logging.debug("Comparing names - Entered: '%s' | DB: '%s'", entered_names, db_names)
        logging.debug("Comparing surname - Entered: '%s' | DB: '%s'", entered_surname, db_surname)
        logging.debug("Comparing DOB - Entered: '%s' | DB: '%s'", entered_dob, db_dob)
        logging.debug("Comparing chief code - Entered: '%s' | DB: '%s'", entered_chief_code, db_chief_code)

        # Compare user-entered details with database details
        details_match = True
        mismatches = {
            "surnameMismatch": False,
            "namesMismatch": False,
            "dobMismatch": False,
            "chiefCodeMismatch": False
        }

        if entered_surname.lower() != db_surname.lower():
            mismatches["surnameMismatch"] = True
            details_match = False
        if entered_names.lower() != db_names.lower():
            mismatches["namesMismatch"] = True
            details_match = False
        if entered_dob != db_dob:
            mismatches["dobMismatch"] = True
            details_match = False
        if entered_chief_code != db_chief_code:
            mismatches["chiefCodeMismatch"] = True
            details_match = False

        # Load captured image
        captured_file = request.files['captured_image']
        captured_img = np.frombuffer(captured_file.read(), np.uint8)
        captured_img = cv2.imdecode(captured_img, cv2.IMREAD_COLOR)
        captured_img_rgb = cv2.cvtColor(captured_img, cv2.COLOR_BGR2RGB)
        captured_encodings = face_recognition.face_encodings(captured_img_rgb)

        if not captured_encodings:
            return jsonify({"error": "No faces found in the captured image", "detailsMatch": details_match, **mismatches}), 400

        captured_encoding = captured_encodings[0]

        # Load ID image from file system
        id_img = cv2.imread(id_photo_path)
        if id_img is None:
            return jsonify({"error": "Failed to load ID image from path", "detailsMatch": details_match, **mismatches}), 500

        id_img_rgb = cv2.cvtColor(id_img, cv2.COLOR_BGR2RGB)
        id_encodings = face_recognition.face_encodings(id_img_rgb)

        if not id_encodings:
            return jsonify({"error": "No faces found in the ID image", "detailsMatch": details_match, **mismatches}), 400

        id_encoding = id_encodings[0]

        # Compare captured image with ID image
        match = face_recognition.compare_faces([id_encoding], captured_encoding, tolerance=0.5)
        distance = face_recognition.face_distance([id_encoding], captured_encoding)[0]

        similarity_score = (1 - distance) * 100

        # Prepare response
        response = {
            "similarity_score": similarity_score,
            "detailsMatch": details_match,
            **mismatches
        }

        if match[0] and details_match:
            response["result"] = "Faces match"
            return jsonify(response), 200
        else:
            if not match[0]:
                response["result"] = "Captured image does not match the ID photo"
            else:
                response["result"] = "Details mismatch"
            return jsonify(response), 400
    
    except Exception as e:
        logging.error("Error during verification: %s", str(e))
        return jsonify({"error": str(e), "detailsMatch": False}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5002)


# In[ ]:




