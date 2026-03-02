export default function AutomationCard({ automation, onToggle, onDelete }) {
  const triggerLabels = {
    comment_keyword: '💬 Comment Keyword',
    dm_keyword:      '✉️ DM Keyword',
    first_dm:        '👋 First DM',
    story_mention:   '📸 Story Mention',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{automation.name}</h3>
          <p className="text-sm text-gray-500 mt-1">
            {triggerLabels[automation.trigger_type] || automation.trigger_type}
          </p>
          {automation.ig_username && (
            <p className="text-xs text-gray-400 mt-1">@{automation.ig_username}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle active/inactive */}
          <button
            onClick={() => onToggle(automation)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              automation.is_active ? 'bg-brand-600' : 'bg-gray-300'
            }`}
            aria-label={automation.is_active ? 'Deactivate' : 'Activate'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                automation.is_active ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <button
            onClick={() => onDelete(automation.id)}
            className="text-red-400 hover:text-red-600 transition-colors text-sm"
            aria-label="Delete automation"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}
