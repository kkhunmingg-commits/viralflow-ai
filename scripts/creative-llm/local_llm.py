"""Local creative LLM for Viral Flow AI (llama.cpp through llama-cpp-python, CPU only).

Reads {"system", "prompt", "schema", "max_tokens"} as JSON on stdin and writes one JSON object to stdout:
{"output": <object matching schema>, "brainstorm": str, "usage": {...}, "model_file": str, "seconds": float, "seed": int}

Two passes: the model first brainstorms in free text, then writes the plan with its output constrained
to the JSON schema (a grammar), so the result always parses. Nothing is sent over the network.
Usage: python local_llm.py /path/to/model.gguf < request.json
"""
import json
import os
import random
import re
import sys
import time

from llama_cpp import Llama


def main() -> None:
    model_path = sys.argv[1]
    request = json.load(sys.stdin)
    started = time.time()
    seed = int(os.environ.get("LOCAL_LLM_SEED") or random.randrange(1, 2**31))
    llm = Llama(model_path=model_path, n_ctx=int(os.environ.get("LOCAL_LLM_CTX", "8192")), n_threads=os.cpu_count() or 4,
                chat_format="chatml", seed=seed, verbose=False)
    usage = {"input_tokens": 0, "output_tokens": 0}

    def chat(messages, **kwargs):
        out = llm.create_chat_completion(messages=messages, temperature=0.7, top_p=0.8, top_k=20, **kwargs)
        usage["input_tokens"] += out["usage"]["prompt_tokens"]
        usage["output_tokens"] += out["usage"]["completion_tokens"]
        return re.sub(r"<think>.*?</think>", "", out["choices"][0]["message"]["content"] or "", flags=re.S).strip()

    system = {"role": "system", "content": request["system"]}
    data = {"role": "user", "content": "ข้อมูล:\n" + request["prompt"]}
    brainstorm = chat([system, data, {"role": "user", "content":
        "ก่อนเขียนแผน คิดสั้น ๆ เป็นข้อ ๆ: คนดูบัญชีนี้น่าจะสนใจอะไร หัวข้อและข้อเท็จจริงไหนน่าเล่าที่สุด "
        "ไอเดีย 3 แบบที่ต่างกันจริงคืออะไร อะไรใน recent ที่ควรเลี่ยง และควรเลือกแบบไหนเพราะอะไร ไม่เกิน 8 บรรทัด /no_think"}],
        max_tokens=int(os.environ.get("LOCAL_LLM_BRAINSTORM_TOKENS", "400")))
    schema = {k: v for k, v in request["schema"].items() if k != "$schema"}
    max_tokens = int(request.get("max_tokens") or 3000)
    output = None
    for attempt in range(2):
        text = chat([system, data, {"role": "assistant", "content": brainstorm},
                     {"role": "user", "content": "เขียนแผนเป็น JSON ตาม schema จากที่คิดไว้ /no_think"}],
                    max_tokens=max_tokens + attempt * 1500, response_format={"type": "json_object", "schema": schema})
        try:
            output = json.loads(text)
            break
        except json.JSONDecodeError:
            # A plan cut off at the token limit does not parse; one longer attempt costs only machine time.
            continue
    if output is None:
        sys.stderr.write("local LLM output did not parse as JSON\n")
        sys.exit(2)
    json.dump({"output": output, "brainstorm": brainstorm, "usage": usage, "model_file": os.path.basename(model_path),
               "seconds": round(time.time() - started, 1), "seed": seed}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
