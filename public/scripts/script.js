const video = document.getElementById("video");

// Load models and start video
Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
  faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
  faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
  faceapi.nets.faceExpressionNet.loadFromUri("/models"),
]).then(startVideo);

function startVideo() {
  navigator.mediaDevices.getUserMedia({ video: {} })
    .then((stream) => (video.srcObject = stream))
    .catch((err) => console.error("Error accessing webcam:", err));
}

// Fetch labeled descriptors from the backend
async function loadLabeledDescriptors() {
  try {
    const response = await fetch("/api/students/descriptors");
    const students = await response.json();

    const labeledDescriptors = students.map((student) => {
      const descriptors = student.faceDescriptors.map((descriptor) =>
        new Float32Array(descriptor)
      );
      return new faceapi.LabeledFaceDescriptors(student.studentId, descriptors);
    });

    return new faceapi.FaceMatcher(labeledDescriptors);
  } catch (error) {
    console.error("Error loading labeled descriptors:", error);
    return null;
  }
}

video.addEventListener("play", async () => {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);
  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(canvas, displaySize);

  const faceMatcher = await loadLabeledDescriptors();
  if (!faceMatcher) {
    console.error("Face matcher could not be created.");
    return;
  }

  setInterval(async () => {
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resizedDetections);
    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
    faceapi.draw.drawFaceExpressions(canvas, resizedDetections);

    resizedDetections.forEach((detection) => {
      const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
      const box = detection.detection.box;
      const drawBox = new faceapi.draw.DrawBox(box, {
        label: bestMatch.toString(),
      });
      drawBox.draw(canvas);

      if (!bestMatch.toString().includes("unknown")) {
        const matchedStudentId = bestMatch.label;
        redirectToRecognizedPage(matchedStudentId);
      }
    });
  }, 100);
});

// Redirect to recognized.ejs with student ID
function redirectToRecognizedPage(studentId) {
  sessionStorage.setItem("recognizedStudentId", studentId); // Store the student ID in sessionStorage
  window.location.href = `/recognized?studentId=${studentId}`; // Pass the student ID as a query parameter
}