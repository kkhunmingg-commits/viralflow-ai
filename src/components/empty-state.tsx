export function EmptyState({
  code,
  title,
  description,
}: {
  code: string;
  title: string;
  description: string;
}) {
  return (
    <section className="empty-state">
      <span>{code}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="phase-chip">พร้อมสำหรับเฟสถัดไป</div>
    </section>
  );
}

