"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * Put inside a form that removes a library clip: the card disappears the moment the button is pressed instead of
 * after the server round trip. If the action fails the form stops pending and the card comes back.
 */
export function LeaveOnSubmit() {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { ref.current?.closest(".library-clip")?.classList.toggle("is-leaving", pending); }, [pending]);
  return <span ref={ref} hidden />;
}
