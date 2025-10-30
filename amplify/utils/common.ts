const branchName = (process.env.AWS_BRANCH || 'main').replace(/\//g, '-')
const isProduction = process.env.AWS_BRANCH === 'main'

function getResourceName(baseName: string): string {
  return isProduction ? baseName : `${branchName}-${baseName}`
}
export { getResourceName, isProduction }
