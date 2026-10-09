import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function Download({file, children}) {
  // Native anchors preserve the file extension without documentation-route slashes.
  return <a href={useBaseUrl(`/config/${file}`)} download>{children}</a>;
}
