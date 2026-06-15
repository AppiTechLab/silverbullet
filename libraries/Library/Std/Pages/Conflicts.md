#meta

Pages and documents with conflicting copies created by [[^Library/Std/Pages/Maintenance|sync]]. A conflict copy (named `*.conflicted:<timestamp>`) holds the _remote_ version of a file that changed on two ends at once, while the original keeps the local version.

To resolve a conflict: open both versions, decide which content to keep (or merge them by hand), then delete the `.conflicted:` copy.

# Conflicting pages
${some(query[[
  from p = index.pages()
  where p.name:find("%.conflicted:")
  order by p.lastModified desc
  select template.new[==[
    * [[${name:gsub("%.conflicted:.+$", "")}]] — conflict copy: [[${name}]] (remote version modified ${lastModified})
]==](p)
]]) or "No conflicting pages — all in sync!"}

# Conflicting documents
${some(query[[
  from d = index.documents()
  where d.name:find("%.conflicted:")
  order by d.lastModified desc
  select template.new[==[
    * conflict copy: [[${name}]] (remote version modified ${lastModified})
]==](d)
]]) or "No conflicting documents."}
