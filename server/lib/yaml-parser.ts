export function parseYaml(content: string): Record<string, any> | null {
  try {
    const lines = content.split('\n');
    const result: Record<string, any> = {};
    let inBlock = false;
    let blockKey = '';
    let blockContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // simplified block logic
      if (inBlock) {
        if (line.startsWith('  ') || line === '') {
          blockContent.push(line.length >= 2 ? line.substring(2) : line);
        } else {
          result[blockKey] = blockContent.join('\n').trim();
          inBlock = false;
          blockKey = '';
          blockContent = [];
          i--;
        }
      } else {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          if (value === '|') {
            inBlock = true;
            blockKey = key;
          } else if (value.startsWith('[') && value.endsWith(']')) {
            result[key] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
          } else {
            result[key] = value;
          }
        }
      }
    }
    if (inBlock) {
      result[blockKey] = blockContent.join('\n').trim();
    }
    
    // Check if empty object which might mean malformed
    if (Object.keys(result).length === 0) {
      console.warn('Malformed YAML: no valid keys found');
      return null;
    }
    return result;
  } catch (err) {
    console.warn(`Malformed YAML: ${err}`);
    return null;
  }
}
