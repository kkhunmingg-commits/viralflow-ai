import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
export default function PublisherPage() { return <><PageHeading eyebrow="REVIEW QUEUE" title="Publisher" description="ตรวจ อนุมัติ และติดตามสถานะการเผยแพร่" /><EmptyState code="PB" title="Publisher is locked" description="ต้องผ่านการอนุมัติ TikTok ก่อนเปิดการเผยแพร่จริง" /></>; }

