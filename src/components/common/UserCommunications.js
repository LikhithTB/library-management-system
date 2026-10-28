import { useEffect, useState } from "react";
import config from "../../config";

export default function UserCommunications({ user }) {
  const [carousels, setCarousels] = useState([]);

  useEffect(() => {
    let ignore = false;

    const fetchCommunications = async () => {
      try {
        const carouselRes = await fetch(`${config.API_URL}/api/carousels`);
        const carouselData = await carouselRes.json();

        if (!ignore) {
          setCarousels(Array.isArray(carouselData) ? carouselData : []);
        }
      } catch {
        if (!ignore) {
          setCarousels([]);
        }
      }
    };

    fetchCommunications();
    // Re-poll so a notice that expires while the dashboard is left open
    // (this ticker is visible on every page) drops off on its own instead
    // of sitting there until the user happens to navigate somewhere else.
    const interval = setInterval(fetchCommunications, 5 * 60 * 1000);
    return () => { ignore = true; clearInterval(interval); };
  }, [user.role]);

  const now = Date.now();
  const visibleCarousels = carousels.filter(c => !c.expires_at || new Date(c.expires_at).getTime() > now);

  if (visibleCarousels.length === 0) return null;

  return (
    <div className="user-comms-wrap">
      <div className="user-carousel-bar">
        <div className="user-carousel-track">
          {[...visibleCarousels, ...visibleCarousels].map((item, index) => (
            <span key={`${item.id}-${index}`} className="user-carousel-item">
              <span className="user-carousel-badge">Notice</span>
              <span>{item.message}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}