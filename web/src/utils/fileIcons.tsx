import React from 'react';

export function getFileIcon(filename: string): React.ReactNode {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  // Basic styling for the SVG icon
  const svgStyle = { width: '100%', height: '100%', fill: 'currentColor' };

  let svgColor = '#9e9e9e';
  let pathD = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z'; // default doc

  switch (ext) {
    case 'pdf':
      svgColor = '#d32f2f';
      pathD = 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z';
      break;
    case 'doc':
    case 'docx':
      svgColor = '#1976d2';
      pathD = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';
      break;
    case 'xls':
    case 'xlsx':
    case 'csv':
      svgColor = '#388e3c';
      pathD = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-2.6 13.9L9 12l2.4-3.9h2L11.5 12l1.9 3.9h-2zM13 9V3.5L18.5 9H13z';
      break;
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
      svgColor = '#fbc02d';
      pathD = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';
      break;
    case 'txt':
    case 'md':
      svgColor = '#757575';
      pathD = 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';
      break;
  }

  return (
    <div style={{ position: 'relative', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg style={svgStyle} viewBox="0 0 24 24" color={svgColor}>
        <path d={pathD} />
        {['zip', 'tar', 'gz', 'rar'].includes(ext) && (
          <path d="M10 2h4v2h-4zM10 6h4v2h-4zM10 10h4v2h-4z" fill="#000" opacity="0.3"/>
        )}
      </svg>
      {ext && (
        <div style={{
          position: 'absolute',
          bottom: '-4px',
          right: '-4px',
          backgroundColor: svgColor,
          color: '#fff',
          fontSize: '9px',
          fontWeight: 'bold',
          padding: '1px 3px',
          borderRadius: '3px',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}>
          {ext.substring(0, 4)}
        </div>
      )}
    </div>
  );
}
