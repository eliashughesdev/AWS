import { Amplify } from 'aws-amplify'
// @ts-ignore — file is empty locally; populated by `ampx generate outputs` or on Amplify deploy
import outputs from '../../../amplify_outputs.json'

export function configureAmplify(): void {
  Amplify.configure(outputs)
}
