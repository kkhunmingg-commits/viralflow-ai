"""One presenter face per reference image, tolerant of busy backgrounds.

OpenCV's frontal-face Haar cascade often fires on flowers, shelves or patterned
walls next to a real face. The presenter is the largest face; another detection
only counts as a second person when it does not overlap that face, is at least
half its width, and has an eye inside. Images with exactly one detection behave
exactly as before.
"""
from __future__ import annotations


class FaceDetectError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def single_face(image) -> tuple[int, int, int, int]:
    """Return (x, y, w, h) of the presenter face or raise NO_FACE / MULTIPLE_FACES."""
    import cv2
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48))
    faces = sorted((tuple(int(v) for v in face) for face in faces), key=lambda box: -box[2] * box[3])
    if not faces:
        raise FaceDetectError("NO_FACE")
    main = faces[0]
    eyes = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

    def overlaps(a, b) -> bool:
        return not (a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0] or a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1])

    def has_eye(box) -> bool:
        x, y, w, h = box
        upper = gray[y:y + int(h * 0.62), x:x + w]
        size = max(8, w // 8)
        return len(eyes.detectMultiScale(upper, scaleFactor=1.1, minNeighbors=5, minSize=(size, size))) > 0

    for other in faces[1:]:
        if not overlaps(other, main) and other[2] >= main[2] * 0.5 and has_eye(other):
            raise FaceDetectError("MULTIPLE_FACES")
    return main
