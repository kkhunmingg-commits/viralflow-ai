export default function AccountsLoading() {
  return <div className="accounts-page" role="status" aria-label="กำลังโหลดบัญชี TikTok">
    <div className="accounts-hero"><div className="accounts-hero-copy"><p className="accounts-overline">VIRALFLOW / ACCOUNTS</p><h1>บัญชี TikTok</h1><p>กำลังโหลดข้อมูลบัญชีของคุณ</p></div></div>
    <div className="accounts-skeleton" style={{ height: 20, width: 140, marginBottom: 18 }} />
    <div className="accounts-grid"><div className="accounts-card" aria-hidden="true"><div className="accounts-skeleton" style={{ height: 54, width: "65%", marginBottom: 28 }} /><div className="accounts-skeleton" style={{ height: 160 }} /></div><div className="accounts-card" aria-hidden="true"><div className="accounts-skeleton" style={{ height: 54, width: "65%", marginBottom: 28 }} /><div className="accounts-skeleton" style={{ height: 160 }} /></div></div>
  </div>;
}
