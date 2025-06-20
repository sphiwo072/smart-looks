#!/usr/bin/env python
# coding: utf-8

# In[ ]:


from flask import Flask, request, jsonify
from flask_cors import CORS
import face_recognition
import numpy as np
import cv2
import logging

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

logging.basicConfig(level=logging.DEBUG)

# You can adjust this threshold as needed
SIMILARITY_THRESHOLD = 52  

@app.route('/compare', methods=['POST'])
def compare_faces():
    if 'captured_image' not in request.files or 'id_photo' not in request.files:
        return jsonify({"error": "Both captured image and ID photo are required"}), 400

    try:
        # Load captured image
        captured_file = request.files['captured_image']
        captured_img = np.frombuffer(captured_file.read(), np.uint8)
        captured_img = cv2.imdecode(captured_img, cv2.COLOR_BGR2RGB)
        captured_encodings = face_recognition.face_encodings(captured_img)

        if not captured_encodings:
            return jsonify({"error": "No face found in the captured image"}), 400

        captured_encoding = captured_encodings[0]

        # Load ID photo
        id_file = request.files['id_photo']
        id_img = np.frombuffer(id_file.read(), np.uint8)
        id_img = cv2.imdecode(id_img, cv2.COLOR_BGR2RGB)
        id_encodings = face_recognition.face_encodings(id_img)

        if not id_encodings:
            return jsonify({"error": "No face found in the ID photo"}), 400

        id_encoding = id_encodings[0]

        # Calculate face distance and similarity score
        distance = face_recognition.face_distance([id_encoding], captured_encoding)[0]
        similarity_score = (1 - distance) * 100
        
        # Use our defined threshold for determining a match
        match = similarity_score >= SIMILARITY_THRESHOLD
        
        # For debugging
        logging.debug(f"Face distance: {distance}, Similarity score: {similarity_score}%, Match: {match}")

        if match:
            return jsonify({
                "result": "Face match successful",
                "similarity_score": similarity_score,
                "match": True
            }), 200
        else:
            return jsonify({
                "result": "Face does not match",
                "similarity_score": similarity_score,
                "match": False
            }), 200

    except Exception as e:
        logging.error("Error during face comparison: %s", str(e))
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')

