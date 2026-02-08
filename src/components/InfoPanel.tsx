import { useState } from "react";
import infoIcon from "../assets/icons/infoIcon.png";

const InfoPanel = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="info-shell">
      <button
        className="info-trigger"
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open info"
      >
        <img className="info-trigger-icon" src={infoIcon} alt="" aria-hidden="true" />
      </button>

      <div className={`info-overlay ${isOpen ? "is-open" : ""}`}>
        {/* Click the dimmed backdrop to close the panel */}
        <div className="info-backdrop" onClick={() => setIsOpen(false)} />
        {/* Dialog wrapper keeps the content centered and focusable */}
        <div className="info-panel" role="dialog" aria-modal="true" aria-label="Info">
          <header className="info-header">
            <div>
              <p className="info-eyebrow">Mission Control</p>
              <h2>Workspace Info</h2>
            </div>
            <button className="info-close" type="button" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </header>

          <section className="info-content">
            <div className="info-card">
              <h3>About Ursa Spatial Analysis</h3>
              <p>
                Ursa Spatial Analysis is a mission control workspace that blends spatial context,
                live collaboration, and decision-ready notes into a single view. Use it to explore
                map-based insights, capture key observations, and keep conversations tied to the
                places that matter.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default InfoPanel;
