import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listPublishedArticles } from "@/server/repositories/news-repository";
import { Newspaper } from "lucide-react";
import { BRAND } from "@/lib/branding";

export const metadata = { title: "News" };

export default async function NewsPage() {
  const articles = await listPublishedArticles();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={BRAND.name}
        title="News Archive"
        description="The weekly league newspaper — recaps, power rankings, awards, and everything in between."
      />
      <div className="mt-8 space-y-4">
        {articles.length === 0 ? (
          <EmptyState icon={Newspaper} title="No issues published yet" />
        ) : (
          articles.map((article) => (
            <Link
              key={article.id}
              href={article.week ? `/news/${article.season.year}/${article.week}` : "#"}
            >
              <Card className="transition-colors hover:border-primary/60">
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {article.type.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {article.season.year}
                      {article.week ? ` · Week ${article.week}` : ""}
                    </span>
                  </div>
                  <p className="mt-2 font-heading text-xl font-semibold">{article.title}</p>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
