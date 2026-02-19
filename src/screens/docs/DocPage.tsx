import { useParams, Navigate } from 'react-router-dom';
import { DOCS } from './docContent';
import styles from './Docs.module.css';

export function DocPage({ slug: slugProp }: { slug?: string }) {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const slug = slugProp ?? slugParam ?? 'getting-started';
  const doc = DOCS[slug];

  if (!doc) {
    return <Navigate to="/docs" replace />;
  }

  return (
    <article className={styles.article}>
      <h1 className={styles.articleTitle}>{doc.title}</h1>
      <div className={styles.articleBody}>
        {doc.content}
      </div>
    </article>
  );
}
