import { useEffect, useState } from "react";
import config from "../../config";

function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RoleNotifications({ user, title = "Notifications", subtitle = "Admin updates for your role." }) {
  const [announcements, setAnnouncements] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [annRes, broadcastRes] = await Promise.all([
          fetch(`${config.API_URL}/api/announcements`),
          fetch(`${config.API_URL}/api/broadcasts?role=${encodeURIComponent(user.role)}`),
        ]);

        const [annData, broadcastData] = await Promise.all([
          annRes.json(),
          broadcastRes.json(),
        ]);

        if (!ignore) {
          setAnnouncements(Array.isArray(annData) ? annData : []);
          setBroadcasts(Array.isArray(broadcastData) ? broadcastData : []);
        }
      } catch {
        if (!ignore) {
          setAnnouncements([]);
          setBroadcasts([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchData();
    // Re-fetch periodically so a broadcast/announcement that expires while
    // this page is left open disappears on its own, instead of only being
    // re-checked the next time the user navigates to this tab.
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => { ignore = true; clearInterval(interval); };
  }, [user.role]);

  // Belt-and-suspenders client-side filter: even if the fetched payload is a
  // little stale (mid-poll-interval), never render something whose
  // expires_at has already passed on the viewer's clock.
  const now = Date.now();
  const visibleBroadcasts = broadcasts.filter(b => !b.expires_at || new Date(b.expires_at).getTime() > now);
  const visibleAnnouncements = announcements.filter(a => !a.expires_at || new Date(a.expires_at).getTime() > now);

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : (
        <>
          {visibleBroadcasts.length > 0 && (
            <>
              <p className="section-title">Broadcast Messages</p>
              <div className="user-broadcast-list" style={{ marginBottom: "24px" }}>
                {visibleBroadcasts.map((broadcast) => (
                  <article key={broadcast.id} className="broadcast-card">
                    <div className="broadcast-title">{broadcast.title}</div>
                    <div className="broadcast-body">{broadcast.body}</div>
                    <div className="broadcast-meta">
                      Visible until {formatDateTime(broadcast.expires_at)}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {visibleAnnouncements.length > 0 && (
            <>
              <p className="section-title">Library Announcements</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
                {visibleAnnouncements.map((announcement) => (
                  <div key={announcement.id} className="announcement-card">
                    <div className="announcement-title">{announcement.title}</div>
                    <div className="announcement-body">{announcement.body}</div>
                    <div className="announcement-meta">
                      Posted: {formatDate(announcement.created_at)}
                      {announcement.expires_at && ` · Expires: ${formatDate(announcement.expires_at)}`}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {visibleBroadcasts.length === 0 && visibleAnnouncements.length === 0 && (
            <div className="empty-state">No broadcast messages or announcements right now.</div>
          )}
        </>
      )}
    </div>
  );
}