const { execSync } = require('child_process')

describe('.gitignore hygiene', () => {
  test('no tracked files are ignored by current exclude rules', () => {
    const out = execSync('git ls-files -i -c --exclude-standard', {
      encoding: 'utf8',
    }).trim()
    expect(out).toBe('')
  })
})
