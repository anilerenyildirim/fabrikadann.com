// Her sayfa geçişinde yeniden bağlanır: içerik hafifçe belirir (yalnızca CSS, hareket azaltma tercihine uyar)
export default function StoreTemplate({ children }: { children: React.ReactNode }) {
  return <div className="sayfa-gir">{children}</div>;
}
