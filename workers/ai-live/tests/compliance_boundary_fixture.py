"""Decision transport fixture ONLY; never shipped as a production authority."""
from compliance_speech import speech_request_hash


class ApprovedDecisionBoundary:
    def authorize(self, request, **_kwargs):
        return {"requestId": request["requestId"], "requestHash": speech_request_hash(request),
                "allowed": True, "text": request["text"], "finalStatus": "PASS",
                "policyVersion": "unit-test-policy-v1"}
