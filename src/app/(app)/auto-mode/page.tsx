import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
export default function AutoModePage() { return <><PageHeading eyebrow="ORCHESTRATION" title="Auto Mode" description="ควบคุม START, PAUSE, RESUME และ STOP พร้อม audit trail" /><EmptyState code="AU" title="Automation is disabled" description="Durable Auto Mode จะเริ่มใน Phase 10 หลังทุก gate พร้อม" /></>; }

