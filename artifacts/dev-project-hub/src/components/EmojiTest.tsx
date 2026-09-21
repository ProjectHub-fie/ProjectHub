import { Badge } from "@/components/ui/badge";

export function EmojiTest() {
  const testEmojis = [
    { emoji: '🟠', label: 'Orange Circle', code: '\u{1F7E0}' },
    { emoji: '🟡', label: 'Yellow Circle', code: '\u{1F7E1}' },
    { emoji: '🟢', label: 'Green Circle', code: '\u{1F7E2}' },
    { emoji: '🔴', label: 'Red Circle', code: '\u{1F534}' },
  ];

  return (
    <div className="p-4 bg-slate-800 rounded-lg max-w-md">
      <h3 className="text-white font-medium mb-4">Emoji Rendering Test</h3>
      <div className="space-y-3">
        {testEmojis.map((item, index) => (
          <div key={index} className="flex items-center gap-3">
            <span className="text-2xl debug-status">{item.emoji}</span>
            <span className="text-2xl debug-status">{item.code}</span>
            <Badge variant="secondary" className="debug-status">
              {item.emoji} {item.label}
            </Badge>
          </div>
        ))}
        <div className="pt-2 border-t border-slate-700">
          <p className="text-slate-400 text-sm">
            If emojis don't appear above, your system may not support color emojis.
          </p>
        </div>
      </div>
    </div>
  );
}