document.addEventListener('DOMContentLoaded', async () => {
    let video = document.getElementById('video');
    const captureBtn = document.getElementById('captureBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const compareBtn = document.getElementById('compareBtn');
    const canvas = document.createElement('canvas');
    let stream = null;
    let blinkCount = 0;
    let startTime = null;

    // Use the existing statusMessage div from index.ejs
    const statusDiv = document.getElementById('statusMessage');
    if (!statusDiv) {
        console.error('Status message div not found');
        return;
    }

    function showStatus(message, type = 'info') {
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
    }

    async function loadModels() {
        try {
            await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
            await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
            await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
        } catch (error) {
            showStatus('Error loading models: ' + error.message, 'error');
        }
    }

    function waitForVideoLoad() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video load timeout'));
            }, 10000);

            function checkVideo() {
                if (video.readyState >= 4 && video.videoWidth > 0 && video.videoHeight > 0) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    requestAnimationFrame(checkVideo);
                }
            }
            
            video.addEventListener('loadeddata', checkVideo);
            checkVideo();
        });
    }
    
    async function startCamera() {
        try {
            if (!document.getElementById('video')) {
                video = document.createElement('video');
                video.id = 'video';
                video.width = 320;
                video.height = 240;
                video.autoplay = true;
                video.playsInline = true;
                document.querySelector('.display-area').insertBefore(video, document.getElementById('canvas'));
            }

            const debugCanvas = document.createElement('canvas');
            debugCanvas.width = 320;
            debugCanvas.height = 240;
            debugCanvas.style.position = 'absolute';
            debugCanvas.style.top = '0';
            debugCanvas.style.left = '0';
            debugCanvas.style.pointerEvents = 'none';
            video.parentElement.appendChild(debugCanvas);

            const earDebug = document.createElement('div');
            earDebug.style.position = 'absolute';
            earDebug.style.top = '10px';
            earDebug.style.left = '10px';
            earDebug.style.background = 'rgba(0,0,0,0.7)';
            earDebug.style.color = 'white';
            earDebug.style.padding = '5px';
            earDebug.style.fontFamily = 'monospace';
            video.parentElement.appendChild(earDebug);

            showStatus('Requesting camera access...', 'info');
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera access not supported by this browser.');
            }

            const constraints = {
                video: {
                    facingMode:{ exact: 'user'},
                    width: { ideal: 320 },
                    height: { ideal: 240 }
                }
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            
            await waitForVideoLoad();
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            debugCanvas.width = video.videoWidth;
            debugCanvas.height = video.videoHeight;

            console.log('Video initialized with dimensions:', {
                width: video.videoWidth,
                height: video.videoHeight,
                readyState: video.readyState
            });

            await video.play();
            showStatus('Please look at the camera and blink for at least 5 times within 10 seconds.', 'success');
            detectFaceAndBlinks(debugCanvas, earDebug);
        } catch (error) {
            console.error('Camera error:', error);
            showStatus('Could not access camera: ' + error.message, 'error');
            stopCamera();
        }
    }

    async function detectFaceAndBlinks(debugCanvas, earDebug) {
        blinkCount = 0;
        startTime = Date.now();
        let previousEyeState = 'open';
        let lastBlinkTime = 0;
        let consecutiveNoFace = 0;
        let earBuffer = [];
        let lastFaceSize = null;
        const FACE_MOVEMENT_THRESHOLD = 0.13;
        
        const interval = setInterval(async () => {
            if (Date.now() - startTime > 12000) {
                clearInterval(interval);
                if (blinkCount < 3) {
                    showStatus('Not enough blinks detected. Make sure your area is lit sufficiently and try again.', 'error');
                    stopCamera();
                }
                return;
            }

            try {
                const detections = await faceapi.detectSingleFace(
                    video, 
                    new faceapi.TinyFaceDetectorOptions({
                        inputSize: 320,
                        scoreThreshold: 0.3
                    })
                ).withFaceLandmarks();

                if (!detections) {
                    consecutiveNoFace++;
                    if (consecutiveNoFace > 10) {
                        showStatus('No face detected. Please center your face in the frame.', 'error');
                    }
                    return;
                }

                const faceBox = detections.detection.box;
                const currentFaceSize = faceBox.width * faceBox.height;

                if (lastFaceSize) {
                    const sizeChange = Math.abs(currentFaceSize - lastFaceSize) / lastFaceSize;
                    if (sizeChange > FACE_MOVEMENT_THRESHOLD) {
                        earBuffer = [];
                        lastFaceSize = currentFaceSize;
                        showStatus('Please keep your face steady', 'info');
                        return;
                    }
                }
                lastFaceSize = currentFaceSize;

                consecutiveNoFace = 0;
                const leftEye = detections.landmarks.getLeftEye();
                const rightEye = detections.landmarks.getRightEye();
                const leftEAR = calculateEAR(leftEye);
                const rightEAR = calculateEAR(rightEye);
                const ear = (leftEAR + rightEAR) / 2.0;

                earBuffer.push(ear);
                if (earBuffer.length > 30) {
                    earBuffer.shift();
                }

                const sortedEAR = [...earBuffer].sort((a, b) => b - a);
                const baselineEAR = sortedEAR.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
                const currentThreshold = baselineEAR * 0.85;

                const isBlinking = ear < currentThreshold;
                const currentTime = Date.now();

                /*earDebug.innerHTML = `
                    <div style="color: ${isBlinking ? '#ff0000' : '#00ff00'}; font-weight: bold;">
                        EYE STATE: ${isBlinking ? 'BLINK DETECTED' : 'EYES OPEN'}
                    </div>
                    <div style="margin-top: 10px;">
                        Current EAR: ${ear.toFixed(3)}<br>
                        Baseline EAR: ${baselineEAR.toFixed(3)}<br>
                        Threshold: ${currentThreshold.toFixed(3)}<br>
                        Face Size: ${currentFaceSize.toFixed(0)}<br>
                        Size Change: ${lastFaceSize ? ((currentFaceSize - lastFaceSize) / lastFaceSize * 100).toFixed(1) + '%' : 'N/A'}<br>
                        Blinks Detected: ${blinkCount}/3
                    </div>
                `;*/

                if (isBlinking && previousEyeState === 'open' && 
                    (currentTime - lastBlinkTime > 250)) {
                    blinkCount++;
                    lastBlinkTime = currentTime;
                    showStatus(`Blink detected (${blinkCount}/5)`, 'success');
                }
                previousEyeState = isBlinking ? 'closed' : 'open';

                if (blinkCount >= 5) {
                    clearInterval(interval);
                    showStatus('Liveliness check successful! Capturing photo...', 'success');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    try {
                        await capturePhoto();
                        stopCamera();
                    } catch (error) {
                        console.warn('Photo capture warning:', error);
                    }
                }
            } catch (error) {
                console.warn('Detection warning:', error);
            }
        }, 100);
    }

    function calculateEAR(eye) {
        try {
            const a = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y);
            const b = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y);
            const c = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y);
            const ear = (a + b) / (2.0 * c);
            return 1 / (1 + Math.exp(-30 * (ear - 0.2)));
        } catch (error) {
            console.error('EAR calculation error:', error);
            return 0.3;
        }
    }

    function capturePhoto() {
        return new Promise((resolve, reject) => {
            if (!video || !video.videoWidth || !video.videoHeight) {
                reject(new Error('Video dimensions not available'));
                return;
            }

            requestAnimationFrame(() => {
                try {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                    const img = new Image();
                    img.onload = () => {
                        const capturedImageDisplay = document.getElementById('capturedImageDisplay');
                        capturedImageDisplay.innerHTML = '';
                        capturedImageDisplay.appendChild(img);
                        console.log('Captured image dimensions:', {
                            width: img.width,
                            height: img.height,
                            naturalWidth: img.naturalWidth,
                            naturalHeight: img.naturalHeight
                        });
                        showStatus('Photo captured successfully! Please upload your ID image', 'success');
                        resolve(img);
                    };
                    img.onerror = (error) => {
                        reject(new Error('Failed to create image from capture'));
                    };
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                    img.src = dataUrl;
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        if (video) {
            video.srcObject = null;
            video.remove();
        }
        const debugCanvas = document.querySelector('.display-area canvas:not(#canvas)');
        const earDebug = document.querySelector('.display-area div[style*="absolute"]');
        if (debugCanvas) debugCanvas.remove();
        if (earDebug) earDebug.remove();
    }

    uploadBtn.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.src = e.target.result;
                document.getElementById('uploadedImageDisplay').innerHTML = '';
                document.getElementById('uploadedImageDisplay').appendChild(img);
                showStatus('ID photo uploaded successfully!', 'success');
            };
            reader.readAsDataURL(file);
        }
    });

    compareBtn.addEventListener('click', async () => {
        const capturedImage = document.querySelector('#capturedImageDisplay img');
        const uploadedImage = document.querySelector('#uploadedImageDisplay img');
        const surname = document.getElementById('surname').value.trim();
        const names = document.getElementById('names').value.trim();
        const dob = document.getElementById('dob').value.trim();
        const chiefCode = document.getElementById('chiefCode').value.trim();
        const idNumber = window.loggedInUserIdNumber;

        // Validate inputs
        if (!surname || !names || !dob || !chiefCode) {
            showStatus('Please fill in all required fields (Surname, Names, Date of Birth, Chief Code).', 'error');
            return;
        }
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
            showStatus('Date of Birth must be in dd/mm/yyyy format.', 'error');
            return;
        }
        if (!capturedImage || !uploadedImage) {
            showStatus('Please capture your photo and upload an ID photo.', 'error');
            return;
        }
        if (!idNumber) {
            showStatus('ID number not found. Please log in again.', 'error');
            return;
        }
        if (!capturedImage.complete || !capturedImage.naturalWidth || 
            !uploadedImage.complete || !uploadedImage.naturalWidth) {
            showStatus('Images not fully loaded. Please try again.', 'error');
            return;
        }

        try {
            showStatus('Performing verification...', 'info');

            const capturedBlob = await fetch(capturedImage.src).then(r => r.blob());
            const uploadedBlob = await fetch(uploadedImage.src).then(r => r.blob());

            const initialFormData = new FormData();
            initialFormData.append('captured_image', capturedBlob, 'capture.jpg');
            initialFormData.append('id_photo', uploadedBlob, 'id.jpg');

            const initialResponse = await fetch('http://192.168.1.243:5000/compare', {
                method: 'POST',
                body: initialFormData
            });

            const initialResult = await initialResponse.json();

            if (!initialResponse.ok || !initialResult.match) {
                showStatus(`Verification failed: ${initialResult.error || 'No match. Please try again'}`, 'error');
                return;
            }

            showStatus(`Please wait while we confirm your identity...`, 'success');

            const dbFormData = new FormData();
            dbFormData.append('captured_image', capturedBlob, 'capture.jpg');
            dbFormData.append('id_number', idNumber);
            dbFormData.append('surname', surname);
            dbFormData.append('name', names);
            dbFormData.append('date_of_birth', dob);
            dbFormData.append('chiefCode', chiefCode);

            const dbResponse = await fetch('http://192.168.1.243:5002/verify', {
                method: 'POST',
                body: dbFormData
            });

            const dbResult = await dbResponse.json();

            if (dbResponse.ok && dbResult.result === "Faces match" && dbResult.detailsMatch) {
                showStatus(`Verification successful!`, 'success');
                // Remove user-details section
                const userDetailsSection = document.querySelector('.user-details');
                if (userDetailsSection) {
                    userDetailsSection.remove();
                }
                // Remove capture section (video and images)
                const displayArea = document.querySelector('.display-area');
                if (displayArea) {
                    displayArea.remove();
                }
                // Remove the controls section containing capture/upload buttons
                const captureControls = document.querySelector('.controls');
                if (captureControls) {
                    captureControls.remove();
                }

                // Redirect to options page
                window.location.href = '/options';
            } else {
                let mismatchMessage = 'Identity verification failed: ';
                if (!dbResult.result || dbResult.result !== "Faces match") {
                    //mismatchMessage += 'Face does not match. ';
                }
                if (!dbResult.detailsMatch) {
                    const mismatches = [];
                    if (dbResult.surnameMismatch) mismatches.push('Surname');
                    if (dbResult.namesMismatch) mismatches.push('Name');
                    if (dbResult.dobMismatch) mismatches.push('Date of Birth');
                    if (dbResult.chiefCodeMismatch) mismatches.push('Chief Code');
                    mismatchMessage += `Details mismatch: ${mismatches.length > 0 ? mismatches.join(', ') : 'Unknown'}.`;
                }
                showStatus(mismatchMessage /*+ ` (Similarity: ${typeof dbResult.similarity_score === 'number' ? dbResult.similarity_score.toFixed(2) : 'N/A'}%)`*/, 'error');
            }
        } catch (error) {
            console.error('Verification error:', error);
            showStatus('Error during verification: ' + error.message, 'error');
        }
    });

    captureBtn.addEventListener('click', startCamera);

    await loadModels();
});