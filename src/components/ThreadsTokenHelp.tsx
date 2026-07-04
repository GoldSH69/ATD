interface Props {
  onClose(): void
}

export default function ThreadsTokenHelp({ onClose }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="confirm-modal token-help" role="dialog" aria-modal="true" aria-label="Get Threads access token">
        <div className="confirm-title">Get a Threads access token</div>
        <ol className="help-list">
          <li>Open Meta Developers and select your app.</li>
          <li>Add the Threads API use case if it is not already added.</li>
          <li>Open Threads API settings.</li>
          <li>Click Add or Remove Threads Testers and add your Threads account.</li>
          <li>Accept the tester invite in Threads if Meta asks.</li>
          <li>Return to User Token Generator and generate a token.</li>
          <li>Paste that token into AutoThreads. Leave User ID blank unless testing tells you otherwise.</li>
        </ol>
        <div className="help-note">
          Keep the token private. AutoThreads stores it encrypted with your OS keychain.
        </div>
        <div className="confirm-actions">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
